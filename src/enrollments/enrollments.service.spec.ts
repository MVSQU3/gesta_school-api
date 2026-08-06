import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../audit/audit.service';
import { BalanceService } from '../common/balance/balance.service';
import { ReferencesService } from '../common/counters/references.service';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { Payment } from '../payments/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { StudentsService } from '../students/students.service';
import { Enrollment, EnrollmentStatus } from './entities/enrollment.entity';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsService (Tests Unitaires Métier)', () => {
  let service: EnrollmentsService;
  let mockEnrollmentRepository: any;
  let mockSchoolRepository: any;
  let mockClassRoomRepository: any;
  let mockAcademicYearRepository: any;
  let mockPaymentRepository: any;
  let mockStudentsService: any;
  let mockReferencesService: any;
  let mockBalanceService: any;

  beforeEach(async () => {
    mockEnrollmentRepository = {
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    mockSchoolRepository = {
      findOne: jest.fn(),
    };

    mockStudentsService = {
      create: jest.fn(),
      // Par défaut : l'élève ciblé existe, et aucun doublon n'est détecté
      findOneOfSchool: jest.fn().mockResolvedValue({ id: 'student-uuid-1' }),
      findDuplicate: jest.fn().mockResolvedValue(null),
    };

    mockReferencesService = {
      nextEnrollmentReference: jest.fn(),
    };

    mockClassRoomRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'classroom-uuid-1',
        name: '6ème A',
        tuitionFee: 150000,
      }),
    };

    // L'année scolaire est désormais vérifiée avant toute écriture
    mockAcademicYearRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'ac-uuid-1',
        label: '2026-2027',
      }),
    };

    // Sert au refus de suppression d'un dossier portant des versements.
    mockPaymentRepository = {
      count: jest.fn().mockResolvedValue(0),
    };

    mockBalanceService = {
      compute: jest.fn(),
      sumPayments: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        {
          provide: getRepositoryToken(Enrollment),
          useValue: mockEnrollmentRepository,
        },
        {
          provide: getRepositoryToken(School),
          useValue: mockSchoolRepository,
        },
        {
          provide: StudentsService,
          useValue: mockStudentsService,
        },
        {
          provide: ReferencesService,
          useValue: mockReferencesService,
        },
        {
          provide: getRepositoryToken(ClassRoom),
          useValue: mockClassRoomRepository,
        },
        {
          provide: getRepositoryToken(AcademicYear),
          useValue: mockAcademicYearRepository,
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
        },
        {
          provide: BalanceService,
          useValue: mockBalanceService,
        },
        {
          // Le journal d'audit n'est pas l'objet de ces tests : un double
          // silencieux suffit, l'écriture étant volontairement non bloquante.
          provide: AuditService,
          useValue: { record: jest.fn(), diff: jest.fn().mockReturnValue(null) },
        },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);
  });

  describe('create - Génération de Jeton 72h', () => {
    it('doit générer une référence INS-CMB-26-0001 et un délai de 72h exactes', async () => {
      mockSchoolRepository.findOne.mockResolvedValue({
        id: 'school-uuid-1',
        slug: 'CMB',
      });
      mockReferencesService.nextEnrollmentReference.mockResolvedValue(
        'INS-CMB-26-0001',
      );

      const fakeEnrollment = {
        id: 'enrollment-uuid-1',
        schoolId: 'school-uuid-1',
        studentId: 'student-uuid-1',
        classRoomId: 'classroom-uuid-1',
        academicYearId: 'ac-uuid-1',
        reference: 'INS-CMB-26-0001',
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      };

      mockEnrollmentRepository.create.mockReturnValue(fakeEnrollment);
      mockEnrollmentRepository.save.mockResolvedValue(fakeEnrollment);
      // Deux findOne coexistent dans create() : le garde-fou anti-doublon
      // (filtre sur studentId) doit répondre « aucun dossier existant », et le
      // rechargement final (filtre sur id) doit renvoyer l'inscription créée.
      mockEnrollmentRepository.findOne.mockImplementation((options: any) =>
        Promise.resolve(options?.where?.studentId ? null : fakeEnrollment),
      );

      const result = await service.create({
        schoolId: 'school-uuid-1',
        studentId: 'student-uuid-1',
        classRoomId: 'classroom-uuid-1',
        academicYearId: 'ac-uuid-1',
      });

      expect(mockSchoolRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'school-uuid-1' },
      });
      expect(result.reference).toBe('INS-CMB-26-0001');
      expect(result.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      // Vérification que le délai d'expiration est bien situé à environ 72 heures dans le futur
      const diffHours =
        (result.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(Math.round(diffHours)).toBe(72);
    });

    it('doit figer le tarif de la classe sur le dossier et tracer son auteur', async () => {
      mockSchoolRepository.findOne.mockResolvedValue({
        id: 'school-uuid-1',
        slug: 'CMB',
      });
      mockReferencesService.nextEnrollmentReference.mockResolvedValue(
        'INS-CMB-26-0001',
      );
      mockClassRoomRepository.findOne.mockResolvedValue({
        id: 'classroom-uuid-1',
        tuitionFee: 150000,
      });
      mockEnrollmentRepository.create.mockImplementation((e: any) => e);
      mockEnrollmentRepository.save.mockImplementation((e: any) =>
        Promise.resolve({ ...e, id: 'enrollment-uuid-1' }),
      );
      // Aucun dossier existant pour ce couple élève/année (garde-fou),
      // et rechargement final par id.
      mockEnrollmentRepository.findOne.mockImplementation((options: any) =>
        Promise.resolve(
          options?.where?.studentId ? null : { id: 'enrollment-uuid-1' },
        ),
      );

      await service.create(
        {
          schoolId: 'school-uuid-1',
          studentId: 'student-uuid-1',
          classRoomId: 'classroom-uuid-1',
          academicYearId: 'ac-uuid-1',
        },
        'user-secretaire-1',
      );

      expect(mockEnrollmentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalDue: 150000,
          createdByUserId: 'user-secretaire-1',
          status: EnrollmentStatus.PENDING_PAYMENT,
        }),
      );
    });

    it('doit refuser une classe qui n’appartient pas à l’école', async () => {
      mockClassRoomRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          schoolId: 'school-uuid-1',
          studentId: 'student-uuid-1',
          classRoomId: 'classroom-autre-ecole',
          academicYearId: 'ac-uuid-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('renew - Le Clonage Fantôme 👻', () => {
    it('doit échouer si le dossier n’est pas encore expiré', async () => {
      const activeEnrollment = {
        id: 'enrollment-uuid-1',
        schoolId: 'school-uuid-1',
        reference: 'INS-CMB-26-0001',
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000), // Valide encore 24h
      };

      mockEnrollmentRepository.findOne.mockResolvedValue(activeEnrollment);

      await expect(service.renew('enrollment-uuid-1', 'school-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('doit renouveler la référence et réinitialiser les 72h si le dossier est expiré (Clonage Fantôme)', async () => {
      const expiredEnrollment = {
        id: 'enrollment-uuid-1',
        schoolId: 'school-uuid-1',
        reference: 'INS-CMB-26-0001',
        status: EnrollmentStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 1000), // Déjà expiré
      };

      mockEnrollmentRepository.findOne.mockResolvedValue(expiredEnrollment);
      mockSchoolRepository.findOne.mockResolvedValue({
        id: 'school-uuid-1',
        slug: 'CMB',
      });
      mockReferencesService.nextEnrollmentReference.mockResolvedValue(
        'INS-CMB-26-0002',
      );

      mockEnrollmentRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity),
      );

      const renewed = await service.renew('enrollment-uuid-1', 'school-uuid-1');

      expect(renewed.reference).toBe('INS-CMB-26-0002');
      expect(renewed.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      const diffHours =
        (renewed.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(Math.round(diffHours)).toBe(72);
    });

    it('doit consommer une nouvelle séquence à chaque renouvellement (pas de collision de référence)', async () => {
      const enrollment = {
        id: 'enrollment-uuid-1',
        schoolId: 'school-uuid-1',
        reference: 'INS-CMB-26-0001',
        status: EnrollmentStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 1000),
      };

      mockEnrollmentRepository.findOne.mockResolvedValue(enrollment);
      mockSchoolRepository.findOne.mockResolvedValue({
        id: 'school-uuid-1',
        slug: 'CMB',
      });
      mockEnrollmentRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity),
      );

      // Le compteur en base avance à chaque appel, même si aucune ligne
      // d'inscription n'est créée par le renouvellement.
      let sequence = 1;
      mockReferencesService.nextEnrollmentReference.mockImplementation(() => {
        sequence += 1;
        return Promise.resolve(
          `INS-CMB-26-${sequence.toString().padStart(4, '0')}`,
        );
      });

      const first = await service.renew('enrollment-uuid-1', 'school-uuid-1');
      const firstReference = first.reference;

      // On ré-expire le dossier pour pouvoir le renouveler une seconde fois
      enrollment.status = EnrollmentStatus.EXPIRED;
      enrollment.expiresAt = new Date(Date.now() - 1000);

      const second = await service.renew('enrollment-uuid-1', 'school-uuid-1');

      expect(firstReference).toBe('INS-CMB-26-0002');
      expect(second.reference).toBe('INS-CMB-26-0003');
      expect(second.reference).not.toBe(firstReference);
    });
  });
});
