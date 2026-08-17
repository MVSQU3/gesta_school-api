import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { BalanceService } from '../common/balance/balance.service';
import { ReferencesService } from '../common/counters/references.service';
import { Payment } from '../payments/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { StudentsService } from '../students/students.service';
import { Enrollment, EnrollmentStatus } from './entities/enrollment.entity';
import { EnrollmentsService } from './enrollments.service';

/**
 * Suite de la couverture du service d'inscription : `enrollments.service.spec`
 * couvre l'ouverture d'un dossier et le renouvellement ; ce fichier couvre le
 * reste de son cycle de vie — réinscription en masse, correction de classe,
 * suppression, validation, dossiers expirés.
 */
describe('EnrollmentsService (cycle de vie d’un dossier)', () => {
  let service: EnrollmentsService;
  let repos: Record<string, any>;
  let students: any;
  let references: any;
  let balance: any;

  const enrollment = (overrides: any = {}) => ({
    id: 'enr-1',
    schoolId: 'school-1',
    reference: 'INS-CMB-26-0001',
    classRoomId: 'class-1',
    totalDue: 150000,
    status: EnrollmentStatus.PENDING_PAYMENT,
    student: { lastName: 'Kone', firstName: 'Ama' },
    ...overrides,
  });

  const classRoom = (overrides: any = {}) => ({
    id: 'class-1',
    name: '6ème A',
    tuitionFee: 150000,
    ...overrides,
  });

  beforeEach(async () => {
    repos = {
      enrollment: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((d) => ({ ...d })),
        save: jest.fn((e) => Promise.resolve({ ...e, id: e.id ?? 'enr-new' })),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
        remove: jest.fn(),
      },
      school: { findOne: jest.fn().mockResolvedValue({ id: 'school-1', slug: 'CMB' }) },
      classRoom: { findOne: jest.fn().mockResolvedValue(classRoom()) },
      year: {
        findOne: jest.fn().mockResolvedValue({ id: 'year-1', label: '2026-2027' }),
      },
      payment: { count: jest.fn().mockResolvedValue(0) },
    };
    students = {
      create: jest.fn(),
      findOneOfSchool: jest
        .fn()
        .mockResolvedValue({ id: 's1', lastName: 'Kone', firstName: 'Ama' }),
      findDuplicate: jest.fn().mockResolvedValue(null),
    };
    references = {
      nextEnrollmentReference: jest.fn().mockResolvedValue('INS-CMB-26-0001'),
    };
    balance = {
      compute: jest.fn().mockResolvedValue({ balance: 0 }),
      sumPayments: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
        { provide: getRepositoryToken(School), useValue: repos.school },
        { provide: getRepositoryToken(ClassRoom), useValue: repos.classRoom },
        { provide: getRepositoryToken(AcademicYear), useValue: repos.year },
        { provide: getRepositoryToken(Payment), useValue: repos.payment },
        { provide: StudentsService, useValue: students },
        { provide: ReferencesService, useValue: references },
        { provide: BalanceService, useValue: balance },
        {
          provide: AuditService,
          useValue: { record: jest.fn(), diff: jest.fn().mockReturnValue(null) },
        },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);
  });

  describe('bulkEnroll', () => {
    const dto = {
      classRoomId: 'class-1',
      academicYearId: 'year-1',
      studentIds: ['s1', 's2'],
    };

    /**
     * `create` interroge le dépôt deux fois : la garde anti-doublon, filtrée
     * sur `studentId`, puis le rechargement du dossier par son `id`. Les
     * distinguer évite que la garde ne réponde au rechargement, et
     * inversement.
     */
    const withoutExistingEnrollment = () =>
      repos.enrollment.findOne.mockImplementation((options: any) =>
        Promise.resolve(
          options?.where?.studentId ? null : enrollment({ id: 'enr-new' }),
        ),
      );

    beforeEach(() => withoutExistingEnrollment());

    it('refuse une classe d’accueil étrangère à l’établissement', async () => {
      repos.classRoom.findOne.mockResolvedValue(null);

      await expect(service.bulkEnroll(dto as any, 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuse une année scolaire étrangère à l’établissement', async () => {
      repos.year.findOne.mockResolvedValue(null);

      await expect(service.bulkEnroll(dto as any, 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('exige un établissement résolu', async () => {
      await expect(service.bulkEnroll(dto as any, '')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('écarte les doublons de la sélection', async () => {
      const result = await service.bulkEnroll(
        { ...dto, studentIds: ['s1', 's1', 's1'] } as any,
        'school-1',
      );

      // Deux fois le même élève dans la liste ne doit produire qu'un dossier,
      // et ne consommer qu'une référence.
      expect(result.created).toHaveLength(1);
    });

    it('écarte un élève étranger à l’établissement sans faire échouer le lot', async () => {
      // Réponse par identifiant et non par ordre d'appel : `bulkEnroll` et
      // `create` interrogent chacun la fiche du même élève.
      students.findOneOfSchool.mockImplementation((studentId: string) =>
        Promise.resolve(
          studentId === 's1'
            ? { id: 's1', lastName: 'Kone', firstName: 'Ama' }
            : null,
        ),
      );
      withoutExistingEnrollment();

      const result = await service.bulkEnroll(dto as any, 'school-1');

      expect(result.created).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toMatch(/n'appartient pas/);
    });

    it('poursuit le lot malgré un dossier déjà ouvert', async () => {
      let first = true;
      repos.enrollment.findOne.mockImplementation((options: any) => {
        if (options?.where?.studentId) {
          const existing = first ? { id: 'deja', reference: 'INS-CMB-26-0009' } : null;
          first = false;
          return Promise.resolve(existing);
        }
        return Promise.resolve(enrollment({ id: 'enr-new' }));
      });

      // Un élève déjà inscrit ne doit pas interrompre la réinscription des
      // trente autres.
      const result = await service.bulkEnroll(dto as any, 'school-1');
      expect(result.skipped).toHaveLength(1);
      expect(result.created).toHaveLength(1);
    });

    it('rend compte des élèves écartés', async () => {
      students.findOneOfSchool.mockResolvedValue(null);

      const result = await service.bulkEnroll(dto as any, 'school-1');
      expect(result.skipped.map((s) => s.studentId)).toEqual(['s1', 's2']);
      expect(result.created).toEqual([]);
    });
  });

  describe('update (correction de classe)', () => {
    beforeEach(() => repos.enrollment.findOne.mockResolvedValue(enrollment()));

    it('refuse un dossier d’un autre établissement', async () => {
      repos.enrollment.findOne.mockResolvedValue(null);

      await expect(
        service.update('enr-x', {} as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('exige un établissement résolu', async () => {
      await expect(service.update('enr-1', {} as any, '')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('n’écrit rien quand la classe est inchangée', async () => {
      await service.update('enr-1', { classRoomId: 'class-1' } as any, 'school-1');
      expect(repos.enrollment.save).not.toHaveBeenCalled();
    });

    it('refuse une classe étrangère à l’établissement', async () => {
      repos.classRoom.findOne.mockResolvedValueOnce(null);

      await expect(
        service.update('enr-1', { classRoomId: 'autre' } as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('reprend le tarif de la nouvelle classe', async () => {
      repos.classRoom.findOne.mockResolvedValue(
        classRoom({ id: 'class-2', name: '5ème A', tuitionFee: 120000 }),
      );

      await service.update('enr-1', { classRoomId: 'class-2' } as any, 'school-1');

      const saved = repos.enrollment.save.mock.calls[0][0];
      expect(saved.totalDue).toBe(120000);
      expect(saved.classRoomId).toBe('class-2');
    });

    it('refuse un transfert vers une classe moins chère que le déjà-versé', async () => {
      repos.classRoom.findOne.mockResolvedValue(
        classRoom({ id: 'class-2', name: '5ème A', tuitionFee: 50000 }),
      );
      balance.sumPayments.mockResolvedValue(90000);

      // Sinon le dossier afficherait un trop-perçu que la caisse ne sait pas
      // traiter.
      await expect(
        service.update('enr-1', { classRoomId: 'class-2' } as any, 'school-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('passe à ENROLLED si le déjà-versé couvre le nouveau tarif', async () => {
      repos.classRoom.findOne.mockResolvedValue(
        classRoom({ id: 'class-2', tuitionFee: 80000 }),
      );
      balance.sumPayments.mockResolvedValue(80000);

      await service.update('enr-1', { classRoomId: 'class-2' } as any, 'school-1');
      expect(repos.enrollment.save.mock.calls[0][0].status).toBe(
        EnrollmentStatus.ENROLLED,
      );
    });

    it('passe à PARTIALLY_PAID si le déjà-versé ne couvre pas tout', async () => {
      repos.classRoom.findOne.mockResolvedValue(
        classRoom({ id: 'class-2', tuitionFee: 200000 }),
      );
      balance.sumPayments.mockResolvedValue(50000);

      await service.update('enr-1', { classRoomId: 'class-2' } as any, 'school-1');
      expect(repos.enrollment.save.mock.calls[0][0].status).toBe(
        EnrollmentStatus.PARTIALLY_PAID,
      );
    });

    it('laisse un dossier expiré expiré malgré la correction', async () => {
      repos.enrollment.findOne.mockResolvedValue(
        enrollment({ status: EnrollmentStatus.EXPIRED }),
      );
      repos.classRoom.findOne.mockResolvedValue(
        classRoom({ id: 'class-2', tuitionFee: 120000 }),
      );

      // L'échéance du jeton n'est pas repoussée par un changement de classe.
      await service.update('enr-1', { classRoomId: 'class-2' } as any, 'school-1');
      expect(repos.enrollment.save.mock.calls[0][0].status).toBe(
        EnrollmentStatus.EXPIRED,
      );
    });
  });

  describe('remove', () => {
    beforeEach(() => repos.enrollment.findOne.mockResolvedValue(enrollment()));

    it('supprime un dossier n’ayant jamais rien encaissé', async () => {
      const result = await service.remove('enr-1', 'school-1');

      expect(repos.enrollment.remove).toHaveBeenCalled();
      expect(result.message).toContain('INS-CMB-26-0001');
      expect(result.message).toContain('Kone Ama');
    });

    it('refuse un dossier portant un versement, même annulé', async () => {
      repos.payment.count.mockResolvedValue(1);

      // Son numéro de reçu a été délivré à une famille : le dossier est une
      // pièce comptable et ne s'efface pas.
      await expect(service.remove('enr-1', 'school-1')).rejects.toThrow(
        ConflictException,
      );
      expect(repos.enrollment.remove).not.toHaveBeenCalled();
    });

    it('refuse un dossier d’un autre établissement', async () => {
      repos.enrollment.findOne.mockResolvedValue(null);

      await expect(service.remove('enr-x', 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('tolère un dossier dont la fiche élève a disparu', async () => {
      repos.enrollment.findOne.mockResolvedValue(
        enrollment({ student: null }),
      );

      const result = await service.remove('enr-1', 'school-1');
      expect(result.message).toContain('INS-CMB-26-0001');
    });

    it('exige un établissement résolu', async () => {
      await expect(service.remove('enr-1', '')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('validate', () => {
    it('passe un dossier en attente à ENROLLED', async () => {
      repos.enrollment.findOne.mockResolvedValue(enrollment());

      const saved = await service.validate('enr-1', 'school-1');
      expect(saved.status).toBe(EnrollmentStatus.ENROLLED);
    });

    it('refuse un dossier d’un autre établissement', async () => {
      repos.enrollment.findOne.mockResolvedValue(
        enrollment({ schoolId: 'school-2' }),
      );

      await expect(service.validate('enr-1', 'school-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuse un dossier déjà validé', async () => {
      repos.enrollment.findOne.mockResolvedValue(
        enrollment({ status: EnrollmentStatus.ENROLLED }),
      );

      await expect(service.validate('enr-1', 'school-1')).rejects.toThrow(
        /déjà validée/,
      );
    });

    it('renvoie vers le renouvellement pour un dossier expiré', async () => {
      repos.enrollment.findOne.mockResolvedValue(
        enrollment({ status: EnrollmentStatus.EXPIRED }),
      );

      await expect(service.validate('enr-1', 'school-1')).rejects.toThrow(
        /renouveler/,
      );
    });

    it('exige un établissement résolu', async () => {
      await expect(service.validate('enr-1', '')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('dossiers expirés', () => {
    it('bascule les jetons échus avant de lister', async () => {
      await service.findExpired('school-1');

      // Sans cette bascule, un dossier échu depuis moins d'une heure
      // n'apparaîtrait pas dans « Les Oubliés ».
      expect(repos.enrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: EnrollmentStatus.PENDING_PAYMENT,
          schoolId: 'school-1',
        }),
        { status: EnrollmentStatus.EXPIRED },
      );
    });

    it('classe les dossiers du plus récemment échu au plus ancien', async () => {
      await service.findExpired('school-1');

      expect(repos.enrollment.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { expiresAt: 'DESC' } }),
      );
    });

    it('exige un établissement résolu', async () => {
      await expect(service.findExpired('')).rejects.toThrow(ForbiddenException);
    });

    it('balaye toutes les écoles pour le SUPER_ADMIN', async () => {
      await service.findAllExpired();

      const [criteria] = repos.enrollment.update.mock.calls[0];
      expect(criteria.schoolId).toBeUndefined();
    });
  });

  describe('findByReference', () => {
    it('joint la situation financière au dossier', async () => {
      repos.enrollment.findOne.mockResolvedValue(enrollment());
      balance.compute.mockResolvedValue({ balance: 60000 });

      const result = await service.findByReference('school-1', 'INS-CMB-26-0001');
      expect(result.balanceInfo).toEqual({ balance: 60000 });
    });

    it('signale une référence inconnue', async () => {
      repos.enrollment.findOne.mockResolvedValue(null);

      await expect(
        service.findByReference('school-1', 'INS-INEXISTANTE'),
      ).rejects.toThrow(NotFoundException);
    });

    it('signale un établissement inconnu', async () => {
      repos.school.findOne.mockResolvedValue(null);

      await expect(
        service.findByReference('school-x', 'INS-CMB-26-0001'),
      ).rejects.toThrow(NotFoundException);
    });

    it('exige un établissement résolu', async () => {
      await expect(service.findByReference('', 'INS-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
