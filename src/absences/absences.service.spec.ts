import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { TeachingService } from '../teaching/teaching.service';
import { Absence, HalfDay } from './entities/absence.entity';
import { AbsencesService } from './absences.service';
import { AuditService } from '../audit/audit.service';

describe('AbsencesService (appel et assiduité)', () => {
  let service: AbsencesService;
  let repos: Record<string, any>;
  let teaching: any;
  let queryBuilder: any;

  const DIRECTOR = {
    id: 'dir-1',
    roles: [Role.DIRECTOR],
    schoolId: 'school-1',
  } as AuthUser;
  const TEACHER = {
    id: 'teach-1',
    roles: [Role.TEACHER],
    schoolId: 'school-1',
  } as AuthUser;
  const SECRETARY = {
    id: 'sec-1',
    roles: [Role.SECRETARY],
    schoolId: 'school-1',
  } as AuthUser;

  /** Date passée, pour ne pas buter sur le refus des dates à venir. */
  const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const openPeriod = (overrides: any = {}) => ({
    id: 'period-1',
    label: '1er Trimestre',
    isClosed: false,
    sequence: 1,
    startDate: '2000-01-01',
    endDate: '2099-12-31',
    ...overrides,
  });

  const dto = (overrides: any = {}) => ({
    classRoomId: 'class-1',
    academicYearId: 'year-1',
    date: yesterday(),
    absences: [{ enrollmentId: 'e1', halfDay: HalfDay.MORNING }],
    ...overrides,
  });

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    repos = {
      absence: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
        create: jest.fn((d) => ({ ...d })),
        merge: jest.fn((c, d) => Object.assign(c, d)),
        save: jest.fn((a) => Promise.resolve(a)),
        remove: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      },
      enrollment: { find: jest.fn().mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]) },
      period: { find: jest.fn().mockResolvedValue([openPeriod()]) },
    };
    teaching = { findAll: jest.fn().mockResolvedValue([{ id: 'a1' }]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbsencesService,
        { provide: getRepositoryToken(Absence), useValue: repos.absence },
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
        { provide: getRepositoryToken(GradingPeriod), useValue: repos.period },
        { provide: TeachingService, useValue: teaching },
        {

          provide: getDataSourceToken(),

          // L'appel s'ecrit dans une transaction : le gestionnaire rejoue les

          // appels sur le depot, pour que les assertions existantes tiennent.

          useValue: {

            transaction: jest.fn((cb: any) => cb(repos.absence)),

          },

        },
            { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get<AbsencesService>(AbsencesService);
  });

  describe('contrôle de la date', () => {
    it('refuse un appel daté du futur', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const date = tomorrow.toISOString().slice(0, 10);

      // On ne constate pas une absence qui n'a pas encore eu lieu.
      await expect(
        service.record(dto({ date }) as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(/date à venir/);
    });

    it('accepte le jour même', async () => {
      const today = new Date().toISOString().slice(0, 10);

      await expect(
        service.record(dto({ date: today }) as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
    });

    it('refuse une date que couvre aucune période', async () => {
      repos.period.find.mockResolvedValue([
        openPeriod({ startDate: '2099-01-01', endDate: '2099-12-31' }),
      ]);

      // L'absence ne serait comptée sur aucun bulletin et resterait invisible.
      await expect(
        service.record(dto() as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(/aucune période de notation/);
    });

    it('refuse une période clôturée', async () => {
      repos.period.find.mockResolvedValue([openPeriod({ isClosed: true })]);

      // Les bulletins sont édités : leur cumul ne peut plus être contredit.
      await expect(
        service.record(dto() as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('ignore une période sans bornes de dates', async () => {
      repos.period.find.mockResolvedValue([
        openPeriod({ startDate: null, endDate: null }),
      ]);

      await expect(
        service.record(dto() as any, 'school-1', DIRECTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('rattache l’absence à la période qui couvre la date', async () => {
      repos.period.find.mockResolvedValue([
        openPeriod({ id: 'p1', startDate: '2000-01-01', endDate: '2000-12-31' }),
        openPeriod({ id: 'p2', startDate: '2001-01-01', endDate: '2099-12-31' }),
      ]);

      await service.record(dto() as any, 'school-1', DIRECTOR);

      // Le rattachement est figé : ajuster les dates de période ensuite ne
      // doit pas déplacer les absences déjà constatées.
      const [saved] = repos.absence.save.mock.calls[0];
      expect(saved[0].gradingPeriodId).toBe('p2');
    });
  });

  describe('droit d’intervenir sur la classe', () => {
    it('refuse un enseignant qui n’intervient pas dans la classe', async () => {
      teaching.findAll.mockResolvedValue([]);

      await expect(
        service.record(dto() as any, 'school-1', TEACHER),
      ).rejects.toThrow(/n'intervenez pas dans cette classe/);
    });

    it('accepte un enseignant affecté', async () => {
      await expect(
        service.record(dto() as any, 'school-1', TEACHER),
      ).resolves.toBeDefined();
    });

    it('dispense la direction du contrôle', async () => {
      teaching.findAll.mockResolvedValue([]);

      await expect(
        service.record(dto() as any, 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
      expect(teaching.findAll).not.toHaveBeenCalled();
    });

    it('dispense le secrétariat en lecture seulement', async () => {
      teaching.findAll.mockResolvedValue([]);
      repos.enrollment.find.mockResolvedValue([]);

      // Le secrétariat centralise le suivi mais ne constate pas l'appel ;
      // l'écriture lui est fermée en amont, dans le contrôleur.
      await expect(
        service.getRollCall('school-1', 'class-1', 'year-1', yesterday(), SECRETARY),
      ).resolves.toBeDefined();
    });

    it('refuse la lecture à un enseignant étranger à la classe', async () => {
      teaching.findAll.mockResolvedValue([]);

      await expect(
        service.getRollCall('school-1', 'class-1', 'year-1', yesterday(), TEACHER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('exige un établissement résolu', async () => {
      await expect(
        service.record(dto() as any, '', DIRECTOR),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('enregistrement de l’appel', () => {
    it('enregistre les absents déclarés', async () => {
      const result = await service.record(
        dto({
          absences: [
            { enrollmentId: 'e1', halfDay: HalfDay.MORNING },
            { enrollmentId: 'e2', halfDay: HalfDay.AFTERNOON },
          ],
        }) as any,
        'school-1',
        DIRECTOR,
      );

      expect(result.recorded).toBe(2);
    });

    it('efface les absences retirées de la liste', async () => {
      const previous = {
        id: 'abs-1',
        enrollmentId: 'e2',
        halfDay: HalfDay.MORNING,
      };
      repos.absence.find.mockResolvedValue([previous]);

      // Un élève retiré de la liste est de nouveau considéré présent.
      const result = await service.record(dto() as any, 'school-1', DIRECTOR);

      expect(repos.absence.remove).toHaveBeenCalledWith([previous]);
      expect(result.cleared).toBe(1);
    });

    it('met à jour une absence déjà constatée plutôt que d’en créer une seconde', async () => {
      repos.absence.find.mockResolvedValue([
        { id: 'abs-1', enrollmentId: 'e1', halfDay: HalfDay.MORNING },
      ]);

      await service.record(dto() as any, 'school-1', DIRECTOR);

      expect(repos.absence.merge).toHaveBeenCalled();
      expect(repos.absence.create).not.toHaveBeenCalled();
      expect(repos.absence.remove).not.toHaveBeenCalled();
    });

    it('ignore un élève étranger à la classe', async () => {
      repos.enrollment.find.mockResolvedValue([{ id: 'e1' }]);

      const result = await service.record(
        dto({
          absences: [
            { enrollmentId: 'e1', halfDay: HalfDay.MORNING },
            { enrollmentId: 'etranger', halfDay: HalfDay.MORNING },
          ],
        }) as any,
        'school-1',
        DIRECTOR,
      );

      expect(result.recorded).toBe(1);
    });

    it('traite séparément matin et après-midi', async () => {
      const result = await service.record(
        dto({
          absences: [
            { enrollmentId: 'e1', halfDay: HalfDay.MORNING },
            { enrollmentId: 'e1', halfDay: HalfDay.AFTERNOON },
          ],
        }) as any,
        'school-1',
        DIRECTOR,
      );

      expect(result.recorded).toBe(2);
    });

    it('considère l’absence non justifiée par défaut', async () => {
      await service.record(dto() as any, 'school-1', DIRECTOR);

      const [saved] = repos.absence.save.mock.calls[0];
      expect(saved[0].isJustified).toBe(false);
    });

    it('vide un motif réduit à des espaces', async () => {
      await service.record(
        dto({
          absences: [
            { enrollmentId: 'e1', halfDay: HalfDay.MORNING, reason: '   ' },
          ],
        }) as any,
        'school-1',
        DIRECTOR,
      );

      const [saved] = repos.absence.save.mock.calls[0];
      expect(saved[0].reason).toBeNull();
    });

    it('trace l’auteur de l’appel', async () => {
      await service.record(dto() as any, 'school-1', TEACHER);

      const [saved] = repos.absence.save.mock.calls[0];
      expect(saved[0].recordedByUserId).toBe('teach-1');
    });

    it('n’interroge pas les absences d’une classe vide', async () => {
      repos.enrollment.find.mockResolvedValue([]);

      const result = await service.record(dto() as any, 'school-1', DIRECTOR);
      expect(result).toEqual({ recorded: 0, cleared: 0 });
      expect(repos.absence.find).not.toHaveBeenCalled();
    });
  });

  describe('feuille d’appel', () => {
    const enrolled = (id: string, lastName: string, firstName = 'Ama') => ({
      id,
      studentId: `st-${id}`,
      student: { firstName, lastName },
    });

    it('rend une feuille vide pour une classe sans élève', async () => {
      repos.enrollment.find.mockResolvedValue([]);

      const sheet = await service.getRollCall(
        'school-1',
        'class-1',
        'year-1',
        '2026-10-05',
        DIRECTOR,
      );
      expect(sheet.students).toEqual([]);
    });

    it('marque présent un élève sans absence', async () => {
      repos.enrollment.find.mockResolvedValue([enrolled('e1', 'Kone')]);

      const sheet = await service.getRollCall(
        'school-1',
        'class-1',
        'year-1',
        '2026-10-05',
        DIRECTOR,
      );
      expect(sheet.students[0].morning).toBeNull();
      expect(sheet.students[0].afternoon).toBeNull();
    });

    it('distingue les deux demi-journées', async () => {
      repos.enrollment.find.mockResolvedValue([enrolled('e1', 'Kone')]);
      repos.absence.find.mockResolvedValue([
        {
          id: 'abs-1',
          enrollmentId: 'e1',
          halfDay: HalfDay.MORNING,
          isJustified: true,
          reason: 'Rendez-vous médical',
        },
      ]);

      const sheet = await service.getRollCall(
        'school-1',
        'class-1',
        'year-1',
        '2026-10-05',
        DIRECTOR,
      );
      expect(sheet.students[0].morning).toMatchObject({ isJustified: true });
      expect(sheet.students[0].afternoon).toBeNull();
    });

    it('trie les élèves par nom puis prénom', async () => {
      repos.enrollment.find.mockResolvedValue([
        enrolled('e1', 'Kone', 'Yao'),
        enrolled('e2', 'Bamba', 'Ali'),
        enrolled('e3', 'Kone', 'Ama'),
      ]);

      const sheet = await service.getRollCall(
        'school-1',
        'class-1',
        'year-1',
        '2026-10-05',
        DIRECTOR,
      );
      expect(sheet.students.map((s) => `${s.lastName} ${s.firstName}`)).toEqual([
        'Bamba Ali',
        'Kone Ama',
        'Kone Yao',
      ]);
    });
  });

  describe('countByPeriod', () => {
    it('sépare les demi-journées justifiées des autres', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        { enrollmentId: 'e1', isJustified: true, count: '2' },
        { enrollmentId: 'e1', isJustified: false, count: '3' },
      ]);

      const counts = await service.countByPeriod('school-1', ['e1'], 'period-1');
      expect(counts.get('e1')).toEqual({ justified: 2, unjustified: 3 });
    });

    it('convertit en nombre les compteurs renvoyés en chaîne', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        { enrollmentId: 'e1', isJustified: false, count: '7' },
      ]);

      const counts = await service.countByPeriod('school-1', ['e1'], 'period-1');
      expect(counts.get('e1')!.unjustified).toBe(7);
    });

    it('n’interroge pas la base sans inscription à compter', async () => {
      const counts = await service.countByPeriod('school-1', [], 'period-1');

      // `IN ()` sans valeur produit une requête SQL invalide.
      expect(counts.size).toBe(0);
      expect(repos.absence.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('n’inclut pas les élèves sans absence', async () => {
      queryBuilder.getRawMany.mockResolvedValue([]);

      const counts = await service.countByPeriod(
        'school-1',
        ['e1', 'e2'],
        'period-1',
      );
      expect(counts.size).toBe(0);
    });
  });

  describe('update et remove', () => {
    it('justifie une absence après coup', async () => {
      repos.absence.findOne.mockResolvedValue({ id: 'abs-1', isJustified: false });

      const saved = await service.update(
        'abs-1',
        { isJustified: true, reason: 'Certificat médical' } as any,
        'school-1',
      );
      expect(saved.isJustified).toBe(true);
      expect(saved.reason).toBe('Certificat médical');
    });

    it('vide un motif réduit à des espaces', async () => {
      repos.absence.findOne.mockResolvedValue({ id: 'abs-1' });

      const saved = await service.update(
        'abs-1',
        { reason: '   ' } as any,
        'school-1',
      );
      expect(saved.reason).toBeNull();
    });

    it('refuse une absence d’un autre établissement', async () => {
      repos.absence.findOne.mockResolvedValue(null);

      await expect(
        service.update('abs-x', {} as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(service.remove('abs-x', 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('supprime une absence', async () => {
      const absence = { id: 'abs-1' };
      repos.absence.findOne.mockResolvedValue(absence);

      await service.remove('abs-1', 'school-1');
      expect(repos.absence.remove).toHaveBeenCalledWith(absence);
    });

    it('exige un établissement résolu', async () => {
      await expect(service.remove('abs-1', '')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.findByEnrollment('e1', '')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('relectures', () => {
    it('renvoie une liste vide pour une classe sans inscription', async () => {
      repos.enrollment.find.mockResolvedValue([]);

      await expect(
        service.findByClassRoomAndDate('school-1', 'class-1', 'year-1', '2026-10-05'),
      ).resolves.toEqual([]);
      expect(repos.absence.find).not.toHaveBeenCalled();
    });

    it('classe l’historique d’un élève du plus récent au plus ancien', async () => {
      await service.findByEnrollment('e1', 'school-1');

      expect(repos.absence.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { date: 'DESC' } }),
      );
    });
  });
});
