import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { School } from '../schools/entities/school.entity';
import { StudentsService } from '../students/students.service';
import { Enrollment, EnrollmentStatus } from './entities/enrollment.entity';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsService (Tests Unitaires Métier)', () => {
  let service: EnrollmentsService;
  let mockEnrollmentRepository: any;
  let mockSchoolRepository: any;
  let mockStudentsService: any;

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
      mockEnrollmentRepository.count.mockResolvedValue(0);

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

      await expect(service.renew('enrollment-uuid-1')).rejects.toThrow(
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
      mockEnrollmentRepository.count.mockResolvedValue(1); // Deuxième référence -> 0002

      mockEnrollmentRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity),
      );

      const renewed = await service.renew('enrollment-uuid-1');

      expect(renewed.reference).toBe('INS-CMB-26-0002');
      expect(renewed.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
      const diffHours =
        (renewed.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(Math.round(diffHours)).toBe(72);
    });
  });
});
