import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AbsencesService } from '../absences/absences.service';
import { Enrollment, EnrollmentStatus } from '../enrollments/entities/enrollment.entity';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import { Grade } from '../evaluations/entities/grade.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { ClassRoomSubject } from '../subjects/entities/classroom-subject.entity';
import { BulletinsService } from './bulletins.service';

/**
 * Le calcul des bulletins est l'arithmétique la plus délicate du produit :
 * barèmes hétérogènes ramenés sur 20, pondération des évaluations,
 * coefficients par matière, absences neutralisées, rangs avec ex aequo.
 * Chaque cas est vérifié contre une valeur calculée à la main.
 */
describe('BulletinsService (calcul des bulletins)', () => {
  let service: BulletinsService;
  let repos: Record<string, any>;
  let absencesService: any;

  const PERIOD = {
    id: 'period-1',
    schoolId: 'school-1',
    academicYearId: 'year-1',
    label: '1er Trimestre',
  };

  /**
   * Monte un jeu de données complet.
   * `grades` référence les évaluations par leur id.
   */
  const given = (data: {
    period?: any;
    enrollments?: any[];
    program?: any[];
    evaluations?: any[];
    grades?: any[];
    absences?: Map<string, { justified: number; unjustified: number }>;
  }) => {
    repos.period.findOne.mockResolvedValue(
      data.period === undefined ? PERIOD : data.period,
    );
    repos.enrollment.find.mockResolvedValue(data.enrollments ?? []);
    repos.program.find.mockResolvedValue(data.program ?? []);
    repos.evaluation.find.mockResolvedValue(data.evaluations ?? []);
    repos.grade.find.mockResolvedValue(data.grades ?? []);
    absencesService.countByPeriod.mockResolvedValue(data.absences ?? new Map());
  };

  const student = (id: string, lastName = 'Kone', firstName = 'Ama') => ({
    id,
    studentId: `student-${id}`,
    student: { firstName, lastName },
  });

  const subject = (id: string, name: string, coefficient: number) => ({
    subjectId: id,
    coefficient,
    subject: { name, shortName: name.slice(0, 4).toUpperCase() },
  });

  const evaluation = (
    id: string,
    subjectId: string,
    maxScore = 20,
    weight = 1,
  ) => ({ id, subjectId, maxScore, weight });

  const grade = (
    evaluationId: string,
    enrollmentId: string,
    score: number | null,
    isAbsent = false,
  ) => ({ evaluationId, enrollmentId, score, isAbsent });

  beforeEach(async () => {
    repos = {
      enrollment: { find: jest.fn() },
      evaluation: { find: jest.fn() },
      grade: { find: jest.fn() },
      program: { find: jest.fn() },
      period: { findOne: jest.fn() },
    };
    absencesService = { countByPeriod: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulletinsService,
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
        { provide: getRepositoryToken(Evaluation), useValue: repos.evaluation },
        { provide: getRepositoryToken(Grade), useValue: repos.grade },
        { provide: getRepositoryToken(ClassRoomSubject), useValue: repos.program },
        { provide: getRepositoryToken(GradingPeriod), useValue: repos.period },
        { provide: AbsencesService, useValue: absencesService },
      ],
    }).compile();

    service = module.get<BulletinsService>(BulletinsService);
  });

  describe('garde-fous', () => {
    it('refuse un appel sans établissement', async () => {
      await expect(
        service.getClassBulletins('', 'class-1', 'period-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuse une période inconnue', async () => {
      given({ period: null });

      await expect(
        service.getClassBulletins('school-1', 'class-1', 'period-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rend une liste vide pour une classe sans élève', async () => {
      given({ enrollments: [] });

      const { bulletins } = await service.getClassBulletins(
        'school-1',
        'class-1',
        'period-1',
      );
      expect(bulletins).toEqual([]);
    });

    it('exclut les dossiers expirés du calcul', async () => {
      given({ enrollments: [student('e1')] });
      await service.getClassBulletins('school-1', 'class-1', 'period-1');

      // Un élève dont le jeton 72h a expiré n'est plus dans la classe : le
      // compter fausserait les moyennes de classe et les rangs.
      const where = repos.enrollment.find.mock.calls[0][0].where;
      expect(where.status._value).toEqual([
        EnrollmentStatus.PENDING_PAYMENT,
        EnrollmentStatus.PARTIALLY_PAID,
        EnrollmentStatus.ENROLLED,
      ]);
    });

    it('ne cherche aucune note quand la période n’a pas d’évaluation', async () => {
      given({ enrollments: [student('e1')], evaluations: [] });
      await service.getClassBulletins('school-1', 'class-1', 'period-1');

      expect(repos.grade.find).not.toHaveBeenCalled();
    });
  });

  describe('mise sur 20', () => {
    it('laisse une note sur 20 inchangée', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1', 20)],
        grades: [grade('ev1', 'e1', 14)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(14);
    });

    it('ramène une interrogation sur 10 à son équivalent sur 20', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1', 10)],
        grades: [grade('ev1', 'e1', 7)],
      });

      // 7/10 vaut 14/20 : sans conversion, la moyenne serait divisée par deux.
      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(14);
    });
  });

  describe('moyenne par matière', () => {
    it('moyenne plusieurs notes d’une même matière', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1'), evaluation('ev2', 's1')],
        grades: [grade('ev1', 'e1', 12), grade('ev2', 'e1', 16)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(14);
      expect(bulletins[0].subjects[0].evaluationCount).toBe(2);
    });

    it('pondère les évaluations entre elles', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [
          evaluation('ev1', 's1', 20, 1),
          evaluation('ev2', 's1', 20, 3),
        ],
        grades: [grade('ev1', 'e1', 8), grade('ev2', 'e1', 16)],
      });

      // (8×1 + 16×3) / 4 = 14
      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(14);
    });

    it('traite un poids absent comme 1', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [
          { id: 'ev1', subjectId: 's1', maxScore: 20, weight: null },
          { id: 'ev2', subjectId: 's1', maxScore: 20, weight: null },
        ],
        grades: [grade('ev1', 'e1', 10), grade('ev2', 'e1', 18)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(14);
    });

    it('laisse une matière sans note à null plutôt qu’à zéro', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1), subject('s2', 'Anglais', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 14)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      const anglais = bulletins[0].subjects.find((s) => s.name === 'Anglais');
      expect(anglais?.average).toBeNull();
      expect(anglais?.points).toBeNull();
    });
  });

  describe('absence à une évaluation', () => {
    it('neutralise la note au lieu de la compter zéro', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1'), evaluation('ev2', 's1')],
        grades: [grade('ev1', 'e1', 14), grade('ev2', 'e1', null, true)],
      });

      // Compter l'absence comme 0 donnerait 7 : l'élève serait sanctionné deux
      // fois, par l'absence puis par la moyenne.
      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(14);
      expect(bulletins[0].subjects[0].evaluationCount).toBe(1);
    });

    it('neutralise aussi une note nulle sans drapeau d’absence', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1'), evaluation('ev2', 's1')],
        grades: [grade('ev1', 'e1', 14), grade('ev2', 'e1', null)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(14);
    });

    it('distingue un zéro réel d’une absence', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1'), evaluation('ev2', 's1')],
        grades: [grade('ev1', 'e1', 14), grade('ev2', 'e1', 0)],
      });

      // Un zéro saisi est une note : il doit peser.
      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(7);
    });

    it('ignore une note orpheline dont l’évaluation a disparu', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 14), grade('ev-inconnue', 'e1', 2)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].average).toBe(14);
    });
  });

  describe('moyenne générale et coefficients', () => {
    it('pondère les matières par leur coefficient', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 4), subject('s2', 'Anglais', 2)],
        evaluations: [evaluation('ev1', 's1'), evaluation('ev2', 's2')],
        grades: [grade('ev1', 'e1', 15), grade('ev2', 'e1', 9)],
      });

      // (15×4 + 9×2) / 6 = 78/6 = 13
      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].totalPoints).toBe(78);
      expect(bulletins[0].totalCoefficients).toBe(6);
      expect(bulletins[0].average).toBe(13);
    });

    it('exclut de la moyenne le coefficient d’une matière non évaluée', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 4), subject('s2', 'Anglais', 6)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 15)],
      });

      // Sans cette règle, l'élève verrait 60/10 = 6 alors qu'il n'a été évalué
      // qu'en maths, où il a 15.
      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].totalCoefficients).toBe(4);
      expect(bulletins[0].average).toBe(15);
    });

    it('traite un coefficient absent comme 1', async () => {
      given({
        enrollments: [student('e1')],
        program: [
          { subjectId: 's1', coefficient: null, subject: { name: 'Maths', shortName: 'M' } },
        ],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 14)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].totalCoefficients).toBe(1);
      expect(bulletins[0].average).toBe(14);
    });

    it('laisse la moyenne à null pour un élève sans aucune note', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 4)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].average).toBeNull();
      expect(bulletins[0].totalCoefficients).toBe(0);
    });

    it('arrondit la moyenne à deux décimales', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 3)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 14.286)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].average).toBe(14.29);
    });
  });

  describe('repères de la classe', () => {
    it('calcule moyenne, minimum et maximum par matière', async () => {
      given({
        enrollments: [student('e1'), student('e2', 'Bamba'), student('e3', 'Coulibaly')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [
          grade('ev1', 'e1', 10),
          grade('ev1', 'e2', 14),
          grade('ev1', 'e3', 18),
        ],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      const maths = bulletins[0].subjects[0];
      expect(maths.classAverage).toBe(14);
      expect(maths.classMin).toBe(10);
      expect(maths.classMax).toBe(18);
    });

    it('n’inclut pas les élèves non notés dans la moyenne de classe', async () => {
      given({
        enrollments: [student('e1'), student('e2', 'Bamba')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 16)],
      });

      // Compter l'élève non noté comme 0 ferait chuter la moyenne de classe à 8.
      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects[0].classAverage).toBe(16);
    });

    it('laisse les repères à null pour une matière que personne n’a passée', async () => {
      given({
        enrollments: [student('e1')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [],
        grades: [],
      });

      const maths = (await service.getClassBulletins('school-1', 'c', 'p'))
        .bulletins[0].subjects[0];
      expect(maths.classAverage).toBeNull();
      expect(maths.classMin).toBeNull();
      expect(maths.classMax).toBeNull();
    });
  });

  describe('rang', () => {
    it('classe les élèves par moyenne décroissante', async () => {
      given({
        enrollments: [student('e1', 'Aka'), student('e2', 'Bamba'), student('e3', 'Cisse')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [
          grade('ev1', 'e1', 12),
          grade('ev1', 'e2', 18),
          grade('ev1', 'e3', 15),
        ],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      const rankOf = (id: string) =>
        bulletins.find((b) => b.enrollmentId === id)?.rank;

      expect(rankOf('e2')).toBe(1);
      expect(rankOf('e3')).toBe(2);
      expect(rankOf('e1')).toBe(3);
    });

    it('donne le même rang aux ex aequo', async () => {
      given({
        enrollments: [student('e1', 'Aka'), student('e2', 'Bamba'), student('e3', 'Cisse')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [
          grade('ev1', 'e1', 16),
          grade('ev1', 'e2', 16),
          grade('ev1', 'e3', 10),
        ],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      const rankOf = (id: string) =>
        bulletins.find((b) => b.enrollmentId === id)?.rank;

      expect(rankOf('e1')).toBe(1);
      expect(rankOf('e2')).toBe(1);
      // Le rang suivant tient compte des deux premiers : 3e, pas 2e.
      expect(rankOf('e3')).toBe(3);
    });

    it('ne classe pas les élèves sans note', async () => {
      given({
        enrollments: [student('e1', 'Aka'), student('e2', 'Bamba')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 14)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins.find((b) => b.enrollmentId === 'e1')?.rank).toBe(1);
      expect(bulletins.find((b) => b.enrollmentId === 'e2')?.rank).toBeNull();
    });

    it('compte tous les inscrits dans l’effectif, notés ou non', async () => {
      given({
        enrollments: [student('e1', 'Aka'), student('e2', 'Bamba')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 14)],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].classSize).toBe(2);
    });
  });

  describe('présentation', () => {
    it('trie les matières par nom', async () => {
      given({
        enrollments: [student('e1')],
        program: [
          subject('s1', 'Physique', 1),
          subject('s2', 'Anglais', 1),
          subject('s3', 'Maths', 1),
        ],
        evaluations: [],
        grades: [],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].subjects.map((s) => s.name)).toEqual([
        'Anglais',
        'Maths',
        'Physique',
      ]);
    });

    it('trie les élèves par nom puis prénom', async () => {
      given({
        enrollments: [
          student('e1', 'Kone', 'Yao'),
          student('e2', 'Bamba', 'Ali'),
          student('e3', 'Kone', 'Ama'),
        ],
        program: [],
        evaluations: [],
        grades: [],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins.map((b) => `${b.lastName} ${b.firstName}`)).toEqual([
        'Bamba Ali',
        'Kone Ama',
        'Kone Yao',
      ]);
    });

    it('reporte les absences de la période', async () => {
      given({
        enrollments: [student('e1')],
        program: [],
        evaluations: [],
        grades: [],
        absences: new Map([['e1', { justified: 2, unjustified: 1 }]]),
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].absences).toEqual({ justified: 2, unjustified: 1 });
    });

    it('affiche zéro absence pour un élève sans relevé', async () => {
      given({
        enrollments: [student('e1')],
        program: [],
        evaluations: [],
        grades: [],
        absences: new Map(),
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].absences).toEqual({ justified: 0, unjustified: 0 });
    });

    it('tolère une fiche élève manquante sans faire échouer le bulletin', async () => {
      given({
        enrollments: [{ id: 'e1', studentId: 's', student: null }],
        program: [],
        evaluations: [],
        grades: [],
      });

      const { bulletins } = await service.getClassBulletins('school-1', 'c', 'p');
      expect(bulletins[0].lastName).toBe('');
    });
  });

  describe('getStudentBulletin', () => {
    it('extrait le bulletin d’un élève du calcul de sa classe', async () => {
      repos.enrollment.findOne = jest
        .fn()
        .mockResolvedValue({ id: 'e1', classRoomId: 'class-1' });
      given({
        enrollments: [student('e1'), student('e2', 'Bamba')],
        program: [subject('s1', 'Maths', 1)],
        evaluations: [evaluation('ev1', 's1')],
        grades: [grade('ev1', 'e1', 14), grade('ev1', 'e2', 18)],
      });

      const { bulletin } = await service.getStudentBulletin(
        'school-1',
        'e1',
        'period-1',
      );
      expect(bulletin.enrollmentId).toBe('e1');
      expect(bulletin.average).toBe(14);
      // Le rang vient bien du classement de toute la classe.
      expect(bulletin.rank).toBe(2);
    });

    it('refuse une inscription d’un autre établissement', async () => {
      repos.enrollment.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.getStudentBulletin('school-1', 'e-etranger', 'period-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
