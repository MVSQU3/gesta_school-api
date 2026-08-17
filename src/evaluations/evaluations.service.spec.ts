import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { ClassRoomSubject } from '../subjects/entities/classroom-subject.entity';
import { TeachingService } from '../teaching/teaching.service';
import { EvaluationType } from './entities/evaluation.entity';
import { Evaluation } from './entities/evaluation.entity';
import { Grade } from './entities/grade.entity';
import { EvaluationsService } from './evaluations.service';

describe('EvaluationsService (évaluations et saisie des notes)', () => {
  let service: EvaluationsService;
  let repos: Record<string, any>;
  let teaching: any;

  const DIRECTOR = { id: 'dir-1', roles: [Role.DIRECTOR] } as AuthUser;
  const TEACHER = { id: 'teach-1', roles: [Role.TEACHER] } as AuthUser;

  const period = (overrides: any = {}) => ({
    id: 'period-1',
    schoolId: 'school-1',
    academicYearId: 'year-1',
    label: '1er Trimestre',
    isClosed: false,
    startDate: '2026-09-01',
    endDate: '2026-12-20',
    ...overrides,
  });

  const evaluation = (overrides: any = {}) => ({
    id: 'ev-1',
    schoolId: 'school-1',
    classRoomId: 'class-1',
    subjectId: 'subject-1',
    gradingPeriodId: 'period-1',
    type: EvaluationType.DEVOIR,
    title: 'Devoir n°1',
    maxScore: 20,
    weight: 1,
    gradingPeriod: period(),
    ...overrides,
  });

  const dto = (overrides: any = {}) => ({
    classRoomId: 'class-1',
    subjectId: 'subject-1',
    gradingPeriodId: 'period-1',
    type: EvaluationType.DEVOIR,
    title: 'Devoir n°1',
    date: '2026-10-05',
    ...overrides,
  });

  beforeEach(async () => {
    repos = {
      evaluation: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(evaluation()),
        create: jest.fn((d) => ({ ...d })),
        save: jest.fn((e) => Promise.resolve({ ...e, id: 'ev-1' })),
        remove: jest.fn(),
        createQueryBuilder: jest.fn(),
      },
      grade: {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((d) => ({ ...d })),
        merge: jest.fn((c, d) => Object.assign(c, d)),
        save: jest.fn((g) => Promise.resolve(g)),
      },
      period: { findOne: jest.fn().mockResolvedValue(period()) },
      program: { findOne: jest.fn().mockResolvedValue({ id: 'prog-1' }) },
      enrollment: { find: jest.fn().mockResolvedValue([]) },
    };
    teaching = { isAssigned: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationsService,
        { provide: getRepositoryToken(Evaluation), useValue: repos.evaluation },
        { provide: getRepositoryToken(Grade), useValue: repos.grade },
        { provide: getRepositoryToken(GradingPeriod), useValue: repos.period },
        { provide: getRepositoryToken(ClassRoomSubject), useValue: repos.program },
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
        { provide: TeachingService, useValue: teaching },
      ],
    }).compile();

    service = module.get<EvaluationsService>(EvaluationsService);
  });

  describe('create', () => {
    it('crée une évaluation valide', async () => {
      await expect(
        service.create(dto() as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
    });

    it('exige un établissement résolu', async () => {
      await expect(
        service.create(dto() as any, '', DIRECTOR),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuse une période inconnue', async () => {
      repos.period.findOne.mockResolvedValue(null);

      await expect(
        service.create(dto() as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse une période clôturée', async () => {
      repos.period.findOne.mockResolvedValue(period({ isClosed: true }));

      await expect(
        service.create(dto() as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(/clôturée/);
    });

    it('refuse une matière absente du programme de la classe', async () => {
      repos.program.findOne.mockResolvedValue(null);

      // Sans coefficient ni place au bulletin, la note serait inexploitable.
      await expect(
        service.create(dto() as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(/ne figure pas au programme/);
    });

    it('affecte le créateur à l’évaluation', async () => {
      await service.create(dto() as any, 'school-1', TEACHER);

      expect(repos.evaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdByUserId: 'teach-1' }),
      );
    });

    it('applique un poids de 1 par défaut', async () => {
      await service.create(dto() as any, 'school-1', DIRECTOR);

      expect(repos.evaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 1 }),
      );
    });
  });

  describe('affectation de l’enseignant', () => {
    it('refuse un enseignant non affecté à la matière', async () => {
      teaching.isAssigned.mockResolvedValue(false);

      await expect(
        service.create(dto() as any, 'school-1', TEACHER),
      ).rejects.toThrow(/pas affecté à cette matière/);
    });

    it('accepte un enseignant affecté', async () => {
      teaching.isAssigned.mockResolvedValue(true);

      await expect(
        service.create(dto() as any, 'school-1', TEACHER),
      ).resolves.toBeDefined();
      expect(teaching.isAssigned).toHaveBeenCalledWith(
        'teach-1',
        'class-1',
        'subject-1',
        'year-1',
      );
    });

    it('dispense la direction de ce contrôle', async () => {
      teaching.isAssigned.mockResolvedValue(false);

      await expect(
        service.create(dto() as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
      expect(teaching.isAssigned).not.toHaveBeenCalled();
    });

    it('dispense aussi le SUPER_ADMIN', async () => {
      teaching.isAssigned.mockResolvedValue(false);

      await expect(
        service.create(dto() as any, 'school-1', {
          id: 'admin',
          roles: [Role.SUPER_ADMIN],
        } as AuthUser),
      ).resolves.toBeDefined();
    });
  });

  describe('date dans la période', () => {
    it('refuse une date antérieure à la période', async () => {
      // Un devoir daté hors de sa période fausse le bulletin où il apparaît.
      await expect(
        service.create(dto({ date: '2026-08-15' }) as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse une date postérieure à la période', async () => {
      await expect(
        service.create(dto({ date: '2027-01-10' }) as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepte les dates de bornes', async () => {
      await expect(
        service.create(dto({ date: '2026-09-01' }) as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
      await expect(
        service.create(dto({ date: '2026-12-20' }) as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
    });

    it('n’impose rien quand la période n’a pas de bornes', async () => {
      repos.period.findOne.mockResolvedValue(
        period({ startDate: null, endDate: null }),
      );

      await expect(
        service.create(dto({ date: '2030-01-01' }) as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
    });

    it('tolère une date horodatée complète', async () => {
      await expect(
        service.create(
          dto({ date: '2026-10-05T14:30:00.000Z' }) as any,
          'school-1',
          DIRECTOR,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('doublons d’intitulé', () => {
    const existing = (title: string) => [{ id: 'autre', title }];

    it('refuse un intitulé déjà utilisé', async () => {
      repos.evaluation.find.mockResolvedValue(existing('Devoir n°1'));

      // Deux exemplaires portent chacun leurs notes : le bulletin cumulerait
      // des moyennes concurrentes sans qu'on sache laquelle fait foi.
      await expect(
        service.create(dto() as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('ignore la casse et les espaces multiples', async () => {
      repos.evaluation.find.mockResolvedValue(existing('DEVOIR   N°1  '));

      await expect(
        service.create(dto() as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('ignore les accents', async () => {
      repos.evaluation.find.mockResolvedValue(existing('Interrogation Numero 1'));

      await expect(
        service.create(
          dto({ title: 'Intérrogation Numéro 1' }) as any,
          'school-1',
          DIRECTOR,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('autorise un intitulé réellement différent', async () => {
      repos.evaluation.find.mockResolvedValue(existing('Devoir n°1'));

      await expect(
        service.create(dto({ title: 'Devoir n°2' }) as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
    });

    it('exclut l’évaluation modifiée de sa propre recherche', async () => {
      repos.evaluation.findOne.mockResolvedValue(evaluation());
      repos.evaluation.find.mockResolvedValue([{ id: 'ev-1', title: 'Devoir n°1' }]);

      // Sinon une évaluation se déclarerait en doublon avec elle-même dès
      // qu'on touche à son intitulé.
      await expect(
        service.update('ev-1', { title: 'Devoir n°1' } as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
    });
  });

  describe('barème', () => {
    it('impose 20 à un devoir', async () => {
      await service.create(dto() as any, 'school-1', DIRECTOR);

      expect(repos.evaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxScore: 20 }),
      );
    });

    it('refuse un devoir noté sur un autre barème', async () => {
      await expect(
        service.create(dto({ maxScore: 10 }) as any, 'school-1', DIRECTOR),
      ).rejects.toThrow('Un devoir est toujours noté sur 20.');
    });

    it('laisse une interrogation être notée sur 10', async () => {
      await service.create(
        dto({ type: EvaluationType.INTERROGATION, maxScore: 10 }) as any,
        'school-1',
        DIRECTOR,
      );

      expect(repos.evaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxScore: 10 }),
      );
    });

    it('applique 20 par défaut à une interrogation sans barème', async () => {
      await service.create(
        dto({ type: EvaluationType.INTERROGATION }) as any,
        'school-1',
        DIRECTOR,
      );

      expect(repos.evaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxScore: 20 }),
      );
    });
  });

  describe('update et remove', () => {
    it('refuse de modifier une évaluation d’une période clôturée', async () => {
      repos.evaluation.findOne.mockResolvedValue(
        evaluation({ gradingPeriod: period({ isClosed: true }) }),
      );

      await expect(
        service.update('ev-1', { title: 'Autre' } as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse de supprimer une évaluation d’une période clôturée', async () => {
      repos.evaluation.findOne.mockResolvedValue(
        evaluation({ gradingPeriod: period({ isClosed: true }) }),
      );

      await expect(service.remove('ev-1', 'school-1', DIRECTOR)).rejects.toThrow(
        ConflictException,
      );
      expect(repos.evaluation.remove).not.toHaveBeenCalled();
    });

    it('recalcule le barème quand le type change', async () => {
      repos.evaluation.findOne.mockResolvedValue(
        evaluation({ type: EvaluationType.INTERROGATION, maxScore: 10 }),
      );

      await service.update(
        'ev-1',
        { type: EvaluationType.DEVOIR } as any,
        'school-1',
        DIRECTOR,
      );

      expect(repos.evaluation.save).toHaveBeenCalledWith(
        expect.objectContaining({ maxScore: 20 }),
      );
    });

    it('supprime une évaluation d’une période ouverte', async () => {
      const result = await service.remove('ev-1', 'school-1', DIRECTOR);

      expect(repos.evaluation.remove).toHaveBeenCalled();
      expect(result.message).toContain('Devoir n°1');
    });

    it('refuse une évaluation d’un autre établissement', async () => {
      repos.evaluation.findOne.mockResolvedValue(null);

      await expect(
        service.findOneOfSchool('ev-x', 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('feuille de notes', () => {
    const enrolled = (id: string, lastName: string, firstName = 'Ama') => ({
      id,
      studentId: `st-${id}`,
      student: { firstName, lastName },
    });

    it('trie les élèves par nom puis prénom', async () => {
      repos.enrollment.find.mockResolvedValue([
        enrolled('e1', 'Kone', 'Yao'),
        enrolled('e2', 'Bamba', 'Ali'),
        enrolled('e3', 'Kone', 'Ama'),
      ]);

      const sheet = await service.getGradeSheet('ev-1', 'school-1');
      expect(sheet.students.map((s) => `${s.lastName} ${s.firstName}`)).toEqual([
        'Bamba Ali',
        'Kone Ama',
        'Kone Yao',
      ]);
    });

    it('reporte les notes déjà saisies', async () => {
      repos.enrollment.find.mockResolvedValue([enrolled('e1', 'Kone')]);
      repos.grade.find.mockResolvedValue([
        { enrollmentId: 'e1', score: 14, isAbsent: false, comment: 'Bien' },
      ]);

      const sheet = await service.getGradeSheet('ev-1', 'school-1');
      expect(sheet.students[0]).toMatchObject({
        score: 14,
        isAbsent: false,
        comment: 'Bien',
      });
    });

    it('laisse une note vide plutôt que zéro quand rien n’est saisi', async () => {
      repos.enrollment.find.mockResolvedValue([enrolled('e1', 'Kone')]);

      const sheet = await service.getGradeSheet('ev-1', 'school-1');
      expect(sheet.students[0].score).toBeNull();
      expect(sheet.students[0].isAbsent).toBe(false);
    });
  });

  describe('saveGrades', () => {
    const grades = (entries: any[]) => ({ grades: entries });

    beforeEach(() => {
      repos.enrollment.find.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    });

    it('enregistre une feuille complète', async () => {
      const result = await service.saveGrades(
        'ev-1',
        grades([
          { enrollmentId: 'e1', score: 14 },
          { enrollmentId: 'e2', score: 16 },
        ]) as any,
        'school-1',
        DIRECTOR,
      );

      expect(result.saved).toBe(2);
    });

    it('ne fait rien pour une feuille vide', async () => {
      const result = await service.saveGrades(
        'ev-1',
        grades([]) as any,
        'school-1',
        DIRECTOR,
      );

      expect(result.saved).toBe(0);
      expect(repos.grade.save).not.toHaveBeenCalled();
    });

    it('refuse la saisie sur une période clôturée', async () => {
      repos.evaluation.findOne.mockResolvedValue(
        evaluation({ gradingPeriod: period({ isClosed: true }) }),
      );

      await expect(
        service.saveGrades(
          'ev-1',
          grades([{ enrollmentId: 'e1', score: 14 }]) as any,
          'school-1',
          DIRECTOR,
        ),
      ).rejects.toThrow(/plus modifiables/);
    });

    it('refuse la note d’un élève d’une autre classe', async () => {
      repos.enrollment.find.mockResolvedValue([{ id: 'e1' }]);

      // Sans ce contrôle, on pourrait glisser la note d'un élève étranger à
      // la classe dans la feuille.
      await expect(
        service.saveGrades(
          'ev-1',
          grades([
            { enrollmentId: 'e1', score: 14 },
            { enrollmentId: 'etranger', score: 20 },
          ]) as any,
          'school-1',
          DIRECTOR,
        ),
      ).rejects.toThrow(/ne sont pas inscrits dans cette classe/);
    });

    it('refuse une note au-dessus du barème', async () => {
      await expect(
        service.saveGrades(
          'ev-1',
          grades([{ enrollmentId: 'e1', score: 25 }]) as any,
          'school-1',
          DIRECTOR,
        ),
      ).rejects.toThrow(/dépasse le barème/);
    });

    it('accepte une note égale au barème', async () => {
      await expect(
        service.saveGrades(
          'ev-1',
          grades([{ enrollmentId: 'e1', score: 20 }]) as any,
          'school-1',
          DIRECTOR,
        ),
      ).resolves.toEqual({ saved: 1 });
    });

    it('neutralise la note d’un élève absent', async () => {
      await service.saveGrades(
        'ev-1',
        grades([{ enrollmentId: 'e1', score: 14, isAbsent: true }]) as any,
        'school-1',
        DIRECTOR,
      );

      // Une absence ne vaut pas zéro : la note est effacée, pas mise à 0.
      const [saved] = repos.grade.save.mock.calls[0];
      expect(saved[0]).toMatchObject({ score: null, isAbsent: true });
    });

    it('ne contrôle pas le barème pour un élève absent', async () => {
      await expect(
        service.saveGrades(
          'ev-1',
          grades([{ enrollmentId: 'e1', score: 99, isAbsent: true }]) as any,
          'school-1',
          DIRECTOR,
        ),
      ).resolves.toBeDefined();
    });

    it('met à jour une note existante au lieu d’en créer une seconde', async () => {
      repos.grade.find.mockResolvedValue([
        { enrollmentId: 'e1', score: 10, isAbsent: false },
      ]);

      await service.saveGrades(
        'ev-1',
        grades([{ enrollmentId: 'e1', score: 15 }]) as any,
        'school-1',
        DIRECTOR,
      );

      expect(repos.grade.merge).toHaveBeenCalled();
      expect(repos.grade.create).not.toHaveBeenCalled();
    });

    it('vide un commentaire réduit à des espaces', async () => {
      await service.saveGrades(
        'ev-1',
        grades([{ enrollmentId: 'e1', score: 14, comment: '   ' }]) as any,
        'school-1',
        DIRECTOR,
      );

      const [saved] = repos.grade.save.mock.calls[0];
      expect(saved[0].comment).toBeNull();
    });

    it('trace l’auteur de la saisie', async () => {
      await service.saveGrades(
        'ev-1',
        grades([{ enrollmentId: 'e1', score: 14 }]) as any,
        'school-1',
        TEACHER,
      );

      const [saved] = repos.grade.save.mock.calls[0];
      expect(saved[0].recordedByUserId).toBe('teach-1');
    });

    it('refuse un enseignant non affecté', async () => {
      teaching.isAssigned.mockResolvedValue(false);

      await expect(
        service.saveGrades(
          'ev-1',
          grades([{ enrollmentId: 'e1', score: 14 }]) as any,
          'school-1',
          TEACHER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
