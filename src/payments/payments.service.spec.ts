import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BalanceService } from '../common/balance/balance.service';
import { ReferencesService } from '../common/counters/references.service';
import { Enrollment, EnrollmentStatus } from '../enrollments/entities/enrollment.entity';
import { School } from '../schools/entities/school.entity';
import { Payment, PaymentMethod } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService (Tests Unitaires Encaissement Caisse)', () => {
  let service: PaymentsService;
  let mockPaymentRepository: any;
  let mockEnrollmentRepository: any;
  let mockReferencesService: any;
  let mockBalanceService: any;
  let mockManager: any;
  let mockDataSource: any;
  let transactionCommitted: boolean;

  /** Prépare le manager pour un dossier donné, avec un déjà-versé donné. */
  const givenEnrollment = (enrollment: any, alreadyPaid = 0) => {
    mockManager.findOne.mockImplementation((entity: any) => {
      if (entity === Enrollment) return Promise.resolve(enrollment);
      if (entity === School) return Promise.resolve({ slug: 'CMB' });
      return Promise.resolve(null);
    });
    mockBalanceService.sumPayments.mockResolvedValue(alreadyPaid);
    mockReferencesService.nextReceiptNumber.mockResolvedValue('REC-CMB-26-0001');
    mockManager.create.mockImplementation((_e: any, data: any) => ({ ...data }));
    mockManager.save.mockImplementation((e: any) => Promise.resolve(e));
  };

  beforeEach(async () => {
    transactionCommitted = false;

    mockPaymentRepository = { find: jest.fn(), findOne: jest.fn(), manager: {} };
    mockEnrollmentRepository = { update: jest.fn() };
    mockReferencesService = { nextReceiptNumber: jest.fn() };
    mockBalanceService = { sumPayments: jest.fn(), compute: jest.fn() };
    mockManager = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };

    mockDataSource = {
      transaction: jest.fn(async (cb: any) => {
        const result = await cb(mockManager);
        transactionCommitted = true;
        return result;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: mockPaymentRepository },
        { provide: getRepositoryToken(Enrollment), useValue: mockEnrollmentRepository },
        { provide: ReferencesService, useValue: mockReferencesService },
        { provide: BalanceService, useValue: mockBalanceService },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  const pay = (amount: number, method?: PaymentMethod) =>
    service.processPayment(
      { reference: 'INS-CMB-26-0001', amount, method },
      'school-uuid-1',
      'CMB',
      'user-caissier-1',
    );

  describe('Paiement par tranches', () => {
    it('un premier versement partiel passe le dossier en PARTIALLY_PAID', async () => {
      const enrollment = {
        id: 'enrollment-uuid-1',
        reference: 'INS-CMB-26-0001',
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        totalDue: 150000,
      };
      givenEnrollment(enrollment, 0);

      const result = await pay(50000);

      expect(enrollment.status).toBe(EnrollmentStatus.PARTIALLY_PAID);
      expect(result.balanceAfter).toEqual(
        expect.objectContaining({
          totalDue: 150000,
          amountPaid: 50000,
          balance: 100000,
          isFullyPaid: false,
        }),
      );
      expect(transactionCommitted).toBe(true);
    });

    it('le versement qui solde le dossier le passe en ENROLLED', async () => {
      const enrollment = {
        id: 'enrollment-uuid-1',
        status: EnrollmentStatus.PARTIALLY_PAID,
        expiresAt: new Date(Date.now() - 10 * 24 * 3600 * 1000), // échéance dépassée
        totalDue: 150000,
      };
      givenEnrollment(enrollment, 100000);

      const result = await pay(50000);

      expect(enrollment.status).toBe(EnrollmentStatus.ENROLLED);
      expect(result.balanceAfter.balance).toBe(0);
      expect(result.balanceAfter.isFullyPaid).toBe(true);
    });

    it('refuse un versement supérieur au solde restant dû', async () => {
      givenEnrollment(
        {
          id: 'enrollment-uuid-1',
          status: EnrollmentStatus.PARTIALLY_PAID,
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
          totalDue: 150000,
        },
        120000,
      );

      // Solde restant : 30 000. Le caissier saisit 40 000.
      await expect(pay(40000)).rejects.toThrow(BadRequestException);
      expect(transactionCommitted).toBe(false);
      expect(mockReferencesService.nextReceiptNumber).not.toHaveBeenCalled();
    });

    it('accepte un versement sans contrôle si aucun tarif n’est configuré (totalDue = 0)', async () => {
      const enrollment = {
        id: 'enrollment-uuid-1',
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        totalDue: 0,
      };
      givenEnrollment(enrollment, 0);

      const result = await pay(50000);

      // Comportement rétro-compatible : un paiement solde le dossier
      expect(enrollment.status).toBe(EnrollmentStatus.ENROLLED);
      expect(result.balanceAfter.isFullyPaid).toBe(true);
    });

    it('refuse un versement sur un dossier déjà soldé', async () => {
      givenEnrollment({
        id: 'enrollment-uuid-1',
        status: EnrollmentStatus.ENROLLED,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        totalDue: 150000,
      });

      await expect(pay(10000)).rejects.toThrow(BadRequestException);
      expect(transactionCommitted).toBe(false);
    });
  });

  describe('Expiration du jeton 72h', () => {
    it('refuse le premier versement si le jeton a expiré et bascule le dossier en EXPIRED', async () => {
      givenEnrollment({
        id: 'enrollment-uuid-1',
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() - 1000),
        totalDue: 150000,
      });

      await expect(pay(50000)).rejects.toThrow(BadRequestException);
      expect(transactionCommitted).toBe(false);
      expect(mockEnrollmentRepository.update).toHaveBeenCalledWith(
        { id: 'enrollment-uuid-1' },
        { status: EnrollmentStatus.EXPIRED },
      );
    });

    it('un dossier déjà entamé n’expire plus : le solde reste encaissable après 72h', async () => {
      const enrollment = {
        id: 'enrollment-uuid-1',
        status: EnrollmentStatus.PARTIALLY_PAID,
        expiresAt: new Date(Date.now() - 30 * 24 * 3600 * 1000), // très largement dépassé
        totalDue: 150000,
      };
      givenEnrollment(enrollment, 50000);

      const result = await pay(50000);

      expect(result.balanceAfter.balance).toBe(50000);
      expect(enrollment.status).toBe(EnrollmentStatus.PARTIALLY_PAID);
      expect(mockEnrollmentRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('Traçabilité', () => {
    it('enregistre le caissier et le mode de paiement sur le versement', async () => {
      givenEnrollment(
        {
          id: 'enrollment-uuid-1',
          status: EnrollmentStatus.PENDING_PAYMENT,
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
          totalDue: 150000,
        },
        0,
      );

      await pay(50000, PaymentMethod.MOBILE_MONEY);

      expect(mockManager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          receivedByUserId: 'user-caissier-1',
          method: PaymentMethod.MOBILE_MONEY,
          amount: 50000,
        }),
      );
    });

    it('applique le mode ESPÈCES par défaut', async () => {
      givenEnrollment(
        {
          id: 'enrollment-uuid-1',
          status: EnrollmentStatus.PENDING_PAYMENT,
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
          totalDue: 150000,
        },
        0,
      );

      await pay(50000);

      expect(mockManager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({ method: PaymentMethod.CASH }),
      );
    });
  });

  describe('Garde-fous existants', () => {
    it('rejette une référence introuvable pour cette école', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(pay(50000)).rejects.toThrow(NotFoundException);
      expect(transactionCommitted).toBe(false);
    });

    it('verrouille la ligne d’inscription pendant la transaction', async () => {
      givenEnrollment(
        {
          id: 'enrollment-uuid-1',
          status: EnrollmentStatus.PENDING_PAYMENT,
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
          totalDue: 150000,
        },
        0,
      );

      await pay(50000);

      expect(mockManager.findOne).toHaveBeenCalledWith(
        Enrollment,
        expect.objectContaining({
          where: { reference: 'INS-CMB-26-0001', schoolId: 'school-uuid-1' },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('réserve le numéro de reçu dans la transaction', async () => {
      givenEnrollment(
        {
          id: 'enrollment-uuid-1',
          status: EnrollmentStatus.PENDING_PAYMENT,
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
          totalDue: 150000,
        },
        0,
      );

      await pay(50000);

      expect(mockReferencesService.nextReceiptNumber).toHaveBeenCalledWith(
        'school-uuid-1',
        'CMB',
        mockManager,
      );
    });
  });
});
