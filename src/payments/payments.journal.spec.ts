import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../audit/audit.service';
import { BalanceService } from '../common/balance/balance.service';
import { ReferencesService } from '../common/counters/references.service';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import {
  CancellationType,
  Payment,
  PaymentMethod,
} from './entities/payment.entity';
import { PaymentsService } from './payments.service';

/**
 * Suite de la couverture de la caisse : `payments.service.spec` couvre
 * l'encaissement ; ce fichier couvre l'annulation, le journal et la
 * réimpression des reçus.
 */
describe('PaymentsService (annulation, journal, reçus)', () => {
  let service: PaymentsService;
  let paymentRepo: any;
  let manager: any;
  let audit: any;
  let balance: any;
  let queryBuilder: any;

  const payment = (overrides: any = {}) => ({
    id: 'pay-1',
    schoolId: 'school-1',
    enrollmentId: 'enr-1',
    receiptNumber: 'REC-CMB-26-0001',
    amount: 40000,
    cancelledAt: null,
    ...overrides,
  });

  const enrollment = (overrides: any = {}) => ({
    id: 'enr-1',
    totalDue: 100000,
    status: EnrollmentStatus.PARTIALLY_PAID,
    ...overrides,
  });

  const cancelDto = {
    type: CancellationType.ERROR,
    reason: '  Erreur de saisie  ',
  };

  beforeEach(async () => {
    queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getCount: jest.fn().mockResolvedValue(0),
      getRawOne: jest.fn().mockResolvedValue({ count: '0', amount: '0' }),
      getRawMany: jest.fn().mockResolvedValue([]),
      getMany: jest.fn().mockResolvedValue([]),
      clone: jest.fn(),
    };
    // `findJournal` dérive plusieurs requêtes de la même base : le clone doit
    // rester un query builder complet.
    queryBuilder.clone.mockReturnValue(queryBuilder);

    paymentRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      query: jest.fn().mockResolvedValue([{ total: '0' }]),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      manager: {},
    };

    manager = {
      findOne: jest.fn(),
      save: jest.fn((e) => Promise.resolve(e)),
      create: jest.fn((_e, d) => ({ ...d })),
    };
    balance = {
      sumPayments: jest.fn().mockResolvedValue(0),
      compute: jest.fn(),
    };

    audit = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(Enrollment), useValue: { update: jest.fn() } },
        { provide: ReferencesService, useValue: { nextReceiptNumber: jest.fn() } },
        { provide: BalanceService, useValue: balance },
        {
          provide: getDataSourceToken(),
          useValue: { transaction: jest.fn((cb: any) => cb(manager)) },
        },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('annulation d’un versement', () => {
    /** Programme le versement, le dossier, puis le rechargement final. */
    const given = (p: any, e: any) =>
      manager.findOne.mockImplementation((entity: any) =>
        Promise.resolve(entity === Payment ? p : e),
      );

    it('exige un établissement résolu', async () => {
      await expect(
        service.cancel('pay-1', cancelDto as any, ''),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuse un reçu d’un autre établissement', async () => {
      given(null, null);

      await expect(
        service.cancel('pay-x', cancelDto as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse d’annuler deux fois le même reçu', async () => {
      given(payment({ cancelledAt: new Date() }), enrollment());

      await expect(
        service.cancel('pay-1', cancelDto as any, 'school-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('journalise l’annulation avec le reçu, le montant et le motif', async () => {
      given(payment(), enrollment());

      await service.cancel('pay-1', cancelDto as any, 'school-1');

      // L'annulation est l'opération la plus contestée au comptoir : le motif
      // doit être lisible au journal sans rouvrir le dossier.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PAYMENT_CANCELLED',
          entityType: 'payments',
          schoolId: 'school-1',
        }),
        undefined,
      );
    });

    it('ne journalise rien quand l’annulation est refusée', async () => {
      given(null, enrollment());

      await expect(
        service.cancel('pay-x', cancelDto as any, 'school-1'),
      ).rejects.toThrow();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('verrouille le reçu et le dossier pendant l’opération', async () => {
      given(payment(), enrollment());

      await service.cancel('pay-1', cancelDto as any, 'school-1');

      // Le statut du dossier va être recalculé : un encaissement concurrent
      // ne doit pas s'intercaler.
      const locks = manager.findOne.mock.calls
        .map((c: any[]) => c[1]?.lock?.mode)
        .filter(Boolean);
      expect(locks).toEqual(['pessimistic_write', 'pessimistic_write']);
    });

    it('consigne le motif, le type et l’auteur', async () => {
      given(payment(), enrollment());

      await service.cancel('pay-1', cancelDto as any, 'school-1', 'dir-1');

      const saved = manager.save.mock.calls[0][0];
      expect(saved.cancellationType).toBe(CancellationType.ERROR);
      expect(saved.cancellationReason).toBe('Erreur de saisie');
      expect(saved.cancelledByUserId).toBe('dir-1');
      expect(saved.cancelledAt).toBeInstanceOf(Date);
    });

    it('ramène le dossier en attente quand il ne reste plus rien de versé', async () => {
      given(payment(), enrollment());
      balance.sumPayments.mockResolvedValue(0);

      await service.cancel('pay-1', cancelDto as any, 'school-1');

      const savedEnrollment = manager.save.mock.calls[1][0];
      expect(savedEnrollment.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
    });

    it('repasse le dossier en partiellement réglé s’il reste des versements', async () => {
      given(payment(), enrollment({ status: EnrollmentStatus.ENROLLED }));
      balance.sumPayments.mockResolvedValue(40000);

      await service.cancel('pay-1', cancelDto as any, 'school-1');
      expect(manager.save.mock.calls[1][0].status).toBe(
        EnrollmentStatus.PARTIALLY_PAID,
      );
    });

    it('laisse le dossier réglé si le reste couvre encore le total dû', async () => {
      given(payment(), enrollment({ status: EnrollmentStatus.ENROLLED }));
      balance.sumPayments.mockResolvedValue(100000);

      await service.cancel('pay-1', cancelDto as any, 'school-1');
      expect(manager.save.mock.calls[1][0].status).toBe(
        EnrollmentStatus.ENROLLED,
      );
    });

    it('recalcule le solde à l’intérieur de la transaction', async () => {
      given(payment(), enrollment());

      await service.cancel('pay-1', cancelDto as any, 'school-1');

      // Lire hors du verrou compterait un versement concurrent non encore
      // validé, ou raterait celui qu'on vient d'annuler.
      expect(balance.sumPayments).toHaveBeenCalledWith('enr-1', manager);
    });

    it('annule le reçu même si le dossier a disparu', async () => {
      given(payment(), null);

      await expect(
        service.cancel('pay-1', cancelDto as any, 'school-1'),
      ).resolves.toBeDefined();
      expect(manager.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('journal de caisse', () => {
    it('exige un établissement résolu', async () => {
      await expect(service.findJournal('', {} as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('retient la journée en cours sans dates fournies', async () => {
      await service.findJournal('school-1', {} as any);

      // C'est la clôture de caisse du jour : la question posée par défaut.
      const [, params] = queryBuilder.andWhere.mock.calls[0];
      const today = new Date();
      expect(params.start.getDate()).toBe(today.getDate());
      expect(params.end.getHours()).toBe(23);
    });

    it('inclut la journée entière de la date de fin', async () => {
      await service.findJournal('school-1', {
        from: '2026-08-01',
        to: '2026-08-03',
      } as any);

      // Borner à minuit exclurait tous les encaissements du dernier jour.
      const [, params] = queryBuilder.andWhere.mock.calls[0];
      expect(params.end.getDate()).toBe(3);
      expect(params.end.getHours()).toBe(23);
      expect(params.end.getMinutes()).toBe(59);
    });

    it('traite une date unique comme une journée complète', async () => {
      await service.findJournal('school-1', { from: '2026-08-03' } as any);

      const [, params] = queryBuilder.andWhere.mock.calls[0];
      expect(params.start.getDate()).toBe(3);
      expect(params.end.getDate()).toBe(3);
    });

    it('applique le filtre par mode de règlement', async () => {
      await service.findJournal('school-1', {
        method: PaymentMethod.CASH,
      } as any);

      const clauses = queryBuilder.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(clauses.join(' ')).toContain('payment.method');
    });

    it('applique le filtre par caissier', async () => {
      await service.findJournal('school-1', {
        receivedByUserId: 'acc-1',
      } as any);

      const clauses = queryBuilder.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(clauses.join(' ')).toContain('receivedByUserId');
    });

    it('pagine à 25 lignes par défaut', async () => {
      await service.findJournal('school-1', {} as any);

      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(25);
    });
  });

  describe('réimpression d’un reçu', () => {
    it('exige un établissement résolu', async () => {
      await expect(service.findByReceiptNumber('REC-1', '')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('normalise le numéro saisi', async () => {
      paymentRepo.findOne.mockResolvedValue(payment({ enrollment: enrollment() }));

      await service.findByReceiptNumber('  rec-cmb-26-0001 ', 'school-1');

      // Un numéro recopié à la main arrive souvent en minuscules ou entouré
      // d'espaces.
      expect(paymentRepo.findOne.mock.calls[0][0].where.receiptNumber).toBe(
        'REC-CMB-26-0001',
      );
    });

    it('signale un numéro inconnu', async () => {
      paymentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findByReceiptNumber('REC-INEXISTANT', 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('calcule le solde tel qu’il était après ce versement', async () => {
      paymentRepo.findOne.mockResolvedValue(payment({ enrollment: enrollment() }));
      paymentRepo.query.mockResolvedValue([{ total: '40000' }]);

      const result = await service.findByReceiptNumber('REC-1', 'school-1');
      expect(result.balanceAfter).toEqual({
        totalDue: 100000,
        amountPaid: 40000,
        balance: 60000,
        isFullyPaid: false,
        status: EnrollmentStatus.PARTIALLY_PAID,
      });
    });

    it('compare les horodatages en SQL, sur le couple (paidAt, id)', async () => {
      paymentRepo.findOne.mockResolvedValue(payment({ enrollment: enrollment() }));

      await service.findByReceiptNumber('REC-1', 'school-1');

      // Repasser par un Date JavaScript, tronqué à la milliseconde, ferait
      // sortir le reçu de sa propre somme cumulée.
      const [sql] = paymentRepo.query.mock.calls[0];
      expect(sql).toContain('(p."paidAt", p.id) <=');
      expect(sql).toContain('cancelledAt" IS NULL');
    });

    it('ne rend jamais un solde négatif', async () => {
      paymentRepo.findOne.mockResolvedValue(payment({ enrollment: enrollment() }));
      paymentRepo.query.mockResolvedValue([{ total: '150000' }]);

      const result = await service.findByReceiptNumber('REC-1', 'school-1');
      expect(result.balanceAfter.balance).toBe(0);
      expect(result.balanceAfter.isFullyPaid).toBe(true);
    });

    it('tolère un reçu dont le dossier a disparu', async () => {
      paymentRepo.findOne.mockResolvedValue(payment({ enrollment: null }));

      const result = await service.findByReceiptNumber('REC-1', 'school-1');
      expect(result.balanceAfter.totalDue).toBe(0);
      expect(result.balanceAfter.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
    });
  });

  describe('lecture d’un reçu', () => {
    it('signale un identifiant inconnu', async () => {
      paymentRepo.findOne.mockResolvedValue(null);

      await expect(service.findOneById('pay-x')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('pay-x', 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('cantonne la lecture à l’établissement', async () => {
      paymentRepo.findOne.mockResolvedValue(payment());

      await service.findOne('pay-1', 'school-1');
      expect(paymentRepo.findOne.mock.calls[0][0].where).toEqual({
        id: 'pay-1',
        schoolId: 'school-1',
      });
    });
  });
});
