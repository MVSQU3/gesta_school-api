import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Enrollment, EnrollmentStatus } from '../enrollments/entities/enrollment.entity';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { Payment } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService (Tests Unitaires Encaissement Caisse)', () => {
  let service: PaymentsService;
  let mockPaymentRepository: any;
  let mockEnrollmentRepository: any;
  let mockEnrollmentsService: any;

  beforeEach(async () => {
    mockPaymentRepository = {
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };

    mockEnrollmentRepository = {
      save: jest.fn(),
    };

    mockEnrollmentsService = {
      findByReference: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
        },
        {
          provide: getRepositoryToken(Enrollment),
          useValue: mockEnrollmentRepository,
        },
        {
          provide: EnrollmentsService,
          useValue: mockEnrollmentsService,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('processPayment - Encaissement à la caisse', () => {
    it('doit valider le paiement d’un jeton valide et générer un reçu REC-CMB-26-0001', async () => {
      const validEnrollment = {
        id: 'enrollment-uuid-1',
        reference: 'INS-CMB-26-0001',
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000), // Valide encore 48h
        school: { slug: 'CMB' },
      };

      mockEnrollmentsService.findByReference.mockResolvedValue(validEnrollment);
      mockPaymentRepository.count.mockResolvedValue(0);

      const fakePayment = {
        id: 'payment-uuid-1',
        enrollmentId: 'enrollment-uuid-1',
        amount: 50000,
        receiptNumber: 'REC-CMB-26-0001',
      };

      mockPaymentRepository.create.mockReturnValue(fakePayment);
      mockPaymentRepository.save.mockResolvedValue(fakePayment);

      const result = await service.processPayment({
        reference: 'INS-CMB-26-0001',
        amount: 50000,
      });

      expect(result.receiptNumber).toBe('REC-CMB-26-0001');
      expect(validEnrollment.status).toBe(EnrollmentStatus.ENROLLED);
    });

    it('doit rejeter l’encaissement si l’inscription a déjà été payée', async () => {
      const alreadyPaidEnrollment = {
        id: 'enrollment-uuid-1',
        reference: 'INS-CMB-26-0001',
        status: EnrollmentStatus.ENROLLED,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      };

      mockEnrollmentsService.findByReference.mockResolvedValue(alreadyPaidEnrollment);

      await expect(
        service.processPayment({
          reference: 'INS-CMB-26-0001',
          amount: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('doit rejeter l’encaissement si le jeton a expiré (> 72h)', async () => {
      const expiredEnrollment = {
        id: 'enrollment-uuid-1',
        reference: 'INS-CMB-26-0001',
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() - 1000), // Expiré il y a 1 seconde
        school: { slug: 'CMB' },
      };

      mockEnrollmentsService.findByReference.mockResolvedValue(expiredEnrollment);

      await expect(
        service.processPayment({
          reference: 'INS-CMB-26-0001',
          amount: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
