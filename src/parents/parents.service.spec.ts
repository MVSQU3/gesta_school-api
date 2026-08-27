import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AbsencesService } from '../absences/absences.service';
import { AuditService } from '../audit/audit.service';
import { BulletinsService } from '../bulletins/bulletins.service';
import { GradingPeriodsService } from '../grading-periods/grading-periods.service';
import { BalanceService } from '../common/balance/balance.service';
import { Gender } from '../common/enums/gender.enum';
import { Role } from '../common/enums/role.enum';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Grade } from '../evaluations/entities/grade.entity';
import { Payment } from '../payments/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { User } from '../users/entities/user.entity';
import { ParentStudent } from './entities/parent-student.entity';
import { ParentsService } from './parents.service';

describe('ParentsService (espace parent et tutelle)', () => {
  let service: ParentsService;
  let linkRepo: any;
  let usersRepo: any;
  let studentRepo: any;
  let enrollmentRepo: any;
  let gradeRepo: any;
  let paymentRepo: any;
  let schoolRepo: any;
  let balance: any;
  let absences: any;
  let bulletins: any;
  let gradingPeriods: any;
  let audit: any;

  const link = (o: any = {}) => ({
    id: 'link-1',
    parentId: 'parent-1',
    studentId: 'student-1',
    schoolId: 'school-1',
    student: { id: 'student-1', firstName: 'Ama', lastName: 'Kouassi' },
    ...o,
  });

  const parentUser = (o: any = {}) => ({
    id: 'parent-1',
    email: 'parent@exemple.ci',
    firstName: 'Yao',
    lastName: 'Kouassi',
    phone: null,
    gender: Gender.MALE,
    roles: [Role.PARENT],
    isActive: true,
    mustChangePassword: true,
    schoolId: 'school-1',
    createdAt: new Date('2026-08-01'),
    ...o,
  });

  beforeEach(async () => {
    linkRepo = {
      findOne: jest.fn().mockResolvedValue(link()),
      find: jest.fn().mockResolvedValue([link()]),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((d) => Promise.resolve(d)),
      remove: jest.fn(),
    };
    usersRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'parent-1', ...d })),
      save: jest.fn((d) => Promise.resolve(d)),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([parentUser()]),
      })),
    };
    studentRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'student-1', schoolId: 'school-1' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'student-1', schoolId: 'school-1' }),
    };
    enrollmentRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        id: 'enr-1',
        studentId: 'student-1',
        schoolId: 'school-1',
        academicYearId: 'year-1',
        totalDue: 100000,
      }),
    };
    gradeRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    schoolRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'school-1', slug: 'CMB' }),
    };
    balance = { compute: jest.fn().mockResolvedValue({ balance: 0 }) };
    absences = { findByEnrollment: jest.fn().mockResolvedValue([]) };
    bulletins = { getStudentBulletin: jest.fn().mockResolvedValue({}) };
    gradingPeriods = { findAllByYear: jest.fn().mockResolvedValue([{ id: 'period-1' }]) };
    audit = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParentsService,
        { provide: getRepositoryToken(ParentStudent), useValue: linkRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Student), useValue: studentRepo },
        { provide: getRepositoryToken(Enrollment), useValue: enrollmentRepo },
        { provide: getRepositoryToken(Grade), useValue: gradeRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(School), useValue: schoolRepo },
        { provide: BalanceService, useValue: balance },
        { provide: AbsencesService, useValue: absences },
        { provide: BulletinsService, useValue: bulletins },
        { provide: GradingPeriodsService, useValue: gradingPeriods },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<ParentsService>(ParentsService);
  });

  describe('assertGuardianOf — la seule autorisation de l’espace parent', () => {
    it('laisse passer un parent rattaché à l’élève', async () => {
      await expect(
        service.assertGuardianOf('parent-1', 'student-1', 'school-1'),
      ).resolves.toEqual(expect.objectContaining({ id: 'student-1' }));
    });

    it('refuse un élève de la même école mais non rattaché', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertGuardianOf('parent-1', 'student-99', 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse un élève d’une autre école, même rattaché', async () => {
      // Le lien existe, mais pas dans l'école demandée : la requête filtre sur
      // les trois colonnes à la fois, elle ne trouve rien.
      linkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertGuardianOf('parent-1', 'student-1', 'school-2'),
      ).rejects.toThrow(NotFoundException);
    });

    it('répond « introuvable » et non « refusé », pour ne pas révéler l’existence de l’élève', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertGuardianOf('parent-1', 'student-99', 'school-1'),
      ).rejects.toThrow(/n'est pas rattaché à votre compte/);
    });

    it('refuse si le lien subsiste mais que la fiche a changé d’école', async () => {
      studentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertGuardianOf('parent-1', 'student-1', 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lectures de l’espace parent', () => {
    it('refuse le solde d’une inscription qui n’est pas celle de son enfant', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getChildFinance('parent-1', 'enr-1', 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse le bulletin d’une inscription non rattachée', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getChildBulletin('parent-1', 'enr-1', 'period-1', 'school-1'),
      ).rejects.toThrow(NotFoundException);
      expect(bulletins.getStudentBulletin).not.toHaveBeenCalled();
    });

    it('refuse les périodes d’une inscription non rattachée', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getChildPeriods('parent-1', 'enr-1', 'school-1'),
      ).rejects.toThrow(NotFoundException);
      expect(gradingPeriods.findAllByYear).not.toHaveBeenCalled();
    });

    it('renvoie les périodes de l’année de l’enfant', async () => {
      // L'onglet « Notes » restait vide tant que cette lecture passait par la
      // route d'établissement, refusée à un compte parent.
      await expect(
        service.getChildPeriods('parent-1', 'enr-1', 'school-1'),
      ).resolves.toEqual([{ id: 'period-1' }]);
      expect(gradingPeriods.findAllByYear).toHaveBeenCalledWith(
        'school-1',
        'year-1',
      );
    });

    it('refuse les absences d’une inscription non rattachée', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getChildAbsences('parent-1', 'enr-1', 'school-1'),
      ).rejects.toThrow(NotFoundException);
      expect(absences.findByEnrollment).not.toHaveBeenCalled();
    });

    it('refuse une inscription d’une autre école avant même de vérifier la tutelle', async () => {
      enrollmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getChildFinance('parent-1', 'enr-1', 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('délègue le solde au service commun, sans le recalculer', async () => {
      await service.getChildFinance('parent-1', 'enr-1', 'school-1');
      expect(balance.compute).toHaveBeenCalled();
    });

    it('conserve les versements annulés, avec leur motif', async () => {
      paymentRepo.find.mockResolvedValue([
        {
          id: 'pay-1',
          amount: '50000',
          method: 'CASH',
          receiptNumber: 'REC-CMB-26-0001',
          paidAt: new Date(),
          cancelledAt: new Date(),
          cancellationReason: 'Erreur de saisie',
        },
      ]);
      const result = await service.getChildFinance('parent-1', 'enr-1', 'school-1');
      expect(result.payments).toHaveLength(1);
      expect(result.payments[0].cancellationReason).toBe('Erreur de saisie');
    });
  });

  describe('choix de l’année dans l’espace parent', () => {
    const enrollmentsOfTwoYears = [
      {
        id: 'enr-2',
        studentId: 'student-1',
        academicYearId: 'year-2',
        academicYear: { id: 'year-2', label: '2026-2027', isActive: true },
        classRoom: { name: '4ème A' },
        totalDue: 100000,
      },
      {
        id: 'enr-1',
        studentId: 'student-1',
        academicYearId: 'year-1',
        academicYear: { id: 'year-1', label: '2025-2026', isActive: false },
        classRoom: { name: '5ème A' },
        totalDue: 90000,
      },
    ];

    it('retient le dossier le plus récent sans année demandée', async () => {
      enrollmentRepo.find.mockResolvedValue(enrollmentsOfTwoYears);

      const children = await service.getMyChildren('parent-1', 'school-1');

      expect(children[0].enrollment?.id).toBe('enr-2');
    });

    it('retient le dossier de l’année demandée', async () => {
      enrollmentRepo.find.mockResolvedValue(enrollmentsOfTwoYears);

      const children = await service.getMyChildren(
        'parent-1',
        'school-1',
        'year-1',
      );

      expect(children[0].enrollment?.id).toBe('enr-1');
    });

    it('rend un enfant sans dossier pour une année où il n’était pas inscrit', async () => {
      enrollmentRepo.find.mockResolvedValue(enrollmentsOfTwoYears);

      const children = await service.getMyChildren(
        'parent-1',
        'school-1',
        'year-inconnue',
      );

      expect(children[0].enrollment).toBeNull();
    });

    it('transmet l’état de l’année, pour que l’écran signale une année close', async () => {
      enrollmentRepo.find.mockResolvedValue(enrollmentsOfTwoYears);

      const children = await service.getMyChildren(
        'parent-1',
        'school-1',
        'year-1',
      );

      expect(children[0].enrollment?.academicYear).toEqual(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('getMyYears', () => {
    it('ne propose que les années où un enfant a été inscrit, la plus récente en tête', async () => {
      enrollmentRepo.find.mockResolvedValue([
        {
          studentId: 'student-1',
          academicYear: { id: 'year-1', label: '2025-2026', isActive: false },
        },
        {
          studentId: 'student-1',
          academicYear: { id: 'year-2', label: '2026-2027', isActive: true },
        },
        // Doublon : deux enfants la même année ne doivent donner qu'une entrée.
        {
          studentId: 'student-2',
          academicYear: { id: 'year-2', label: '2026-2027', isActive: true },
        },
      ]);

      const years = await service.getMyYears('parent-1', 'school-1');

      expect(years.map((y) => y.label)).toEqual(['2026-2027', '2025-2026']);
    });

    it('ne renvoie rien pour un parent sans enfant rattaché', async () => {
      linkRepo.find.mockResolvedValue([]);

      await expect(service.getMyYears('parent-1', 'school-1')).resolves.toEqual(
        [],
      );
    });
  });

  describe('getChildGrades', () => {
    const gradesOfTwoSubjects = [
      {
        id: 'g-1',
        score: '7.00',
        isAbsent: false,
        comment: 'Peut mieux faire',
        evaluation: {
          gradingPeriodId: 'period-1',
          subjectId: 'sub-math',
          subject: { name: 'Mathématiques' },
          title: 'Interro n°1',
          type: 'INTERROGATION',
          date: '2026-01-10',
          maxScore: 10,
        },
      },
      {
        id: 'g-2',
        score: '14.00',
        isAbsent: false,
        comment: null,
        evaluation: {
          gradingPeriodId: 'period-1',
          subjectId: 'sub-math',
          subject: { name: 'Mathématiques' },
          title: 'Devoir n°1',
          type: 'DEVOIR',
          date: '2026-02-20',
          maxScore: 20,
        },
      },
      {
        id: 'g-3',
        score: '11.00',
        isAbsent: false,
        comment: null,
        evaluation: {
          gradingPeriodId: 'period-2',
          subjectId: 'sub-fr',
          subject: { name: 'Français' },
          title: 'Devoir n°1',
          type: 'DEVOIR',
          date: '2026-04-05',
          maxScore: 20,
        },
      },
    ];

    it('refuse les notes d’une inscription non rattachée', async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getChildGrades('parent-1', 'enr-1', 'period-1', 'school-1'),
      ).rejects.toThrow(NotFoundException);
      expect(gradeRepo.find).not.toHaveBeenCalled();
    });

    it('ne retient que les notes de la période demandée', async () => {
      gradeRepo.find.mockResolvedValue(gradesOfTwoSubjects);

      const subjects = await service.getChildGrades(
        'parent-1',
        'enr-1',
        'period-1',
        'school-1',
      );

      expect(subjects).toHaveLength(1);
      expect(subjects[0].name).toBe('Mathématiques');
      expect(subjects[0].grades).toHaveLength(2);
    });

    it('rend la note telle qu’elle a été saisie, sans la ramener sur 20', async () => {
      gradeRepo.find.mockResolvedValue(gradesOfTwoSubjects);

      const subjects = await service.getChildGrades(
        'parent-1',
        'enr-1',
        'period-1',
        'school-1',
      );

      // Un 7/10 affiché « 14/20 » ne correspondrait plus à la copie rapportée
      // à la maison.
      const interro = subjects[0].grades.find((g) => g.title === 'Interro n°1');
      expect(interro).toMatchObject({ score: 7, maxScore: 10 });
    });

    it('classe les notes de la plus récente à la plus ancienne', async () => {
      gradeRepo.find.mockResolvedValue(gradesOfTwoSubjects);

      const subjects = await service.getChildGrades(
        'parent-1',
        'enr-1',
        'period-1',
        'school-1',
      );

      expect(subjects[0].grades.map((g) => g.title)).toEqual([
        'Devoir n°1',
        'Interro n°1',
      ]);
    });

    it('transmet l’appréciation du professeur', async () => {
      gradeRepo.find.mockResolvedValue(gradesOfTwoSubjects);

      const subjects = await service.getChildGrades(
        'parent-1',
        'enr-1',
        'period-1',
        'school-1',
      );

      expect(
        subjects[0].grades.find((g) => g.title === 'Interro n°1')?.comment,
      ).toBe('Peut mieux faire');
    });
  });

  describe('createParent', () => {
    it('force le rôle PARENT et un mot de passe à changer', async () => {
      // 1er appel : contrôle d'unicité de l'email, doit ne rien trouver.
      // 2e appel : relecture du compte créé, pour la réponse.
      usersRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValue(parentUser());

      const { parent, temporaryPassword } = await service.createParent(
        {
          email: 'Parent@Exemple.CI',
          firstName: 'Yao',
          lastName: 'Kouassi',
          gender: Gender.MALE,
          studentIds: ['student-1'],
        } as any,
        'school-1',
      );

      const saved = usersRepo.save.mock.calls[0][0];
      expect(saved.roles).toEqual([Role.PARENT]);
      expect(saved.mustChangePassword).toBe(true);
      // L'email est normalisé : sans cela, deux comptes ne différant que par
      // la casse échapperaient au contrôle d'unicité.
      expect(saved.email).toBe('parent@exemple.ci');
      expect(temporaryPassword).toHaveLength(10);
      expect(parent.id).toBe('parent-1');
      // Le sexe designe le pere ou la mere dans tous les ecrans.
      expect(saved.gender).toBe(Gender.MALE);
    });

    it('ne stocke jamais le mot de passe provisoire en clair', async () => {
      usersRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValue(parentUser());

      const { temporaryPassword } = await service.createParent(
        { email: 'p@e.ci', firstName: 'Y', lastName: 'K', gender: Gender.FEMALE } as any,
        'school-1',
      );
      const saved = usersRepo.save.mock.calls[0][0];
      expect(saved.passwordHash).not.toBe(temporaryPassword);
      expect(saved).not.toHaveProperty('password');
    });

    it('refuse un email déjà utilisé', async () => {
      usersRepo.findOne.mockResolvedValue(parentUser());
      await expect(
        service.createParent(
          { email: 'p@e.ci', firstName: 'Y', lastName: 'K', gender: Gender.FEMALE } as any,
          'school-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse de rattacher un élève d’une autre école', async () => {
      studentRepo.find.mockResolvedValue([]);
      await expect(
        service.createParent(
          {
            email: 'p@e.ci',
            firstName: 'Y',
            lastName: 'K',
            gender: Gender.MALE,
            studentIds: ['student-autre-ecole'],
          } as any,
          'school-1',
        ),
      ).rejects.toThrow(NotFoundException);
      // Le compte ne doit pas exister si le rattachement échoue.
      expect(usersRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('linkChild', () => {
    it('refuse un rattachement déjà existant', async () => {
      usersRepo.findOne.mockResolvedValue(parentUser());
      await expect(
        service.linkChild('parent-1', { studentId: 'student-1' } as any, 'school-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse d’agir sur un compte d’une autre école', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.linkChild('parent-1', { studentId: 'student-1' } as any, 'school-2'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse d’agir sur un compte qui n’est pas un parent', async () => {
      usersRepo.findOne.mockResolvedValue(parentUser({ roles: [Role.SECRETARY] }));
      await expect(
        service.linkChild('parent-1', { studentId: 'student-1' } as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('requireParentSchool', () => {
    it('refuse un compte sans établissement', () => {
      expect(() =>
        service.requireParentSchool({ id: 'p', roles: [Role.PARENT] } as any),
      ).toThrow(ForbiddenException);
    });
  });

  describe('setActive', () => {
    it('ferme les sessions ouvertes en désactivant le compte', async () => {
      usersRepo.findOne.mockResolvedValue(parentUser());
      await service.setActive('parent-1', false, 'school-1');
      const saved = usersRepo.save.mock.calls[0][0];
      expect(saved.isActive).toBe(false);
      expect(saved.passwordChangedAt).toBeInstanceOf(Date);
    });
  });
});
