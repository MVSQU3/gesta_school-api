import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Enrollment,
  EnrollmentStatus,
} from '../../enrollments/entities/enrollment.entity';
import { Payment } from '../../payments/entities/payment.entity';
import { BalanceService } from './balance.service';

describe('BalanceService (solde d’une inscription)', () => {
  let service: BalanceService;
  let queryBuilder: any;
  let manager: any;

  /** Fait répondre l'agrégat SQL comme PostgreSQL le ferait : une chaîne. */
  const givenSum = (total: string | null) => {
    queryBuilder.getRawOne.mockResolvedValue(
      total === null ? null : { total },
    );
  };

  const enrollment = (totalDue: unknown, status = EnrollmentStatus.PENDING_PAYMENT) =>
    ({ id: 'enr-1', totalDue, status }) as unknown as Enrollment;

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
    };
    manager = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        {
          provide: getRepositoryToken(Payment),
          useValue: { manager },
        },
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
  });

  describe('sumPayments', () => {
    it('convertit en nombre la somme renvoyée sous forme de chaîne', async () => {
      givenSum('40000');
      await expect(service.sumPayments('enr-1')).resolves.toBe(40000);
    });

    it('exclut les versements annulés', async () => {
      givenSum('0');
      await service.sumPayments('enr-1');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'payment.cancelledAt IS NULL',
      );
    });

    it('renvoie 0 quand aucun versement n’existe', async () => {
      givenSum(null);
      await expect(service.sumPayments('enr-1')).resolves.toBe(0);
    });

    it('lit dans la transaction en cours quand un manager est fourni', async () => {
      const txQueryBuilder = { ...queryBuilder, getRawOne: jest.fn() };
      txQueryBuilder.select = jest.fn().mockReturnValue(txQueryBuilder);
      txQueryBuilder.where = jest.fn().mockReturnValue(txQueryBuilder);
      txQueryBuilder.andWhere = jest.fn().mockReturnValue(txQueryBuilder);
      txQueryBuilder.getRawOne.mockResolvedValue({ total: '15000' });
      const txManager: any = {
        createQueryBuilder: jest.fn().mockReturnValue(txQueryBuilder),
      };

      // Sans cela, la caisse lirait hors du verrou posé par la transaction et
      // pourrait encaisser deux fois le même reliquat.
      await expect(service.sumPayments('enr-1', txManager)).resolves.toBe(15000);
      expect(txManager.createQueryBuilder).toHaveBeenCalled();
      expect(manager.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('compute', () => {
    it('calcule le reste à payer d’un dossier partiellement réglé', async () => {
      givenSum('40000');

      await expect(service.compute(enrollment(100000))).resolves.toEqual({
        totalDue: 100000,
        amountPaid: 40000,
        balance: 60000,
        isFullyPaid: false,
        status: EnrollmentStatus.PENDING_PAYMENT,
      });
    });

    it('considère le dossier soldé au franc près', async () => {
      givenSum('100000');
      const result = await service.compute(enrollment(100000));

      expect(result.balance).toBe(0);
      expect(result.isFullyPaid).toBe(true);
    });

    it('ne rend jamais un solde négatif en cas de trop-perçu', async () => {
      givenSum('120000');
      const result = await service.compute(enrollment(100000));

      // Un solde négatif s'afficherait comme une dette de l'école envers la
      // famille, ce que la caisse ne sait pas traiter.
      expect(result.balance).toBe(0);
      expect(result.isFullyPaid).toBe(true);
    });

    it('convertit le montant dû quand PostgreSQL le renvoie en chaîne', async () => {
      givenSum('0');
      const result = await service.compute(enrollment('90000'));

      // Les colonnes `decimal` reviennent en chaîne : sans conversion, la
      // soustraction produirait NaN.
      expect(result.totalDue).toBe(90000);
      expect(result.balance).toBe(90000);
    });

    it('ne déclare pas soldé un dossier sans tarif configuré', async () => {
      givenSum('0');
      const result = await service.compute(enrollment(0));

      // 0 payé sur 0 dû est arithmétiquement « soldé », mais signale en réalité
      // une classe sans tarif : le marquer réglé masquerait l'oubli.
      expect(result.isFullyPaid).toBe(false);
      expect(result.totalDue).toBe(0);
    });

    it('traite un montant dû absent comme zéro', async () => {
      givenSum('0');
      const result = await service.compute(enrollment(null));

      expect(result.totalDue).toBe(0);
      expect(result.balance).toBe(0);
    });

    it('reporte le statut du dossier sans le recalculer', async () => {
      givenSum('100000');
      const result = await service.compute(
        enrollment(100000, EnrollmentStatus.EXPIRED),
      );

      expect(result.status).toBe(EnrollmentStatus.EXPIRED);
    });
  });
});
