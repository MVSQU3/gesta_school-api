import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import { Payment, PaymentMethod } from '../payments/entities/payment.entity';
import { DashboardService } from './dashboard.service';

/**
 * Le tableau de bord agrège des montants : chaque chiffre est vérifié contre
 * une valeur calculée à la main, et les cas dégradés (année absente, division
 * par zéro) doivent rendre un écran affichable plutôt qu'une erreur.
 */
describe('DashboardService (tableau de bord direction)', () => {
  let service: DashboardService;
  let enrollmentRepo: any;
  let paymentRepo: any;
  let yearRepo: any;

  /**
   * Les deux dépôts enchaînent plusieurs agrégats : on programme les réponses
   * dans l'ordre où le service les demande.
   */
  const queueOf = (results: any[]) => {
    let index = 0;
    const qb: any = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(() => Promise.resolve(results[index++])),
      getRawOne: jest.fn(() => Promise.resolve(results[index++])),
    };
    return qb;
  };

  /**
   * @param enrollmentResults statuts, montant dû, détail par classe
   * @param paymentResults    modes de règlement, encaissements du jour, par classe
   */
  const given = (enrollmentResults: any[], paymentResults: any[]) => {
    enrollmentRepo.createQueryBuilder.mockImplementation(() =>
      queueOf(enrollmentResults),
    );
    paymentRepo.createQueryBuilder.mockImplementation(() =>
      queueOf(paymentResults),
    );
  };

  beforeEach(async () => {
    enrollmentRepo = { createQueryBuilder: jest.fn() };
    paymentRepo = { createQueryBuilder: jest.fn() };
    yearRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'year-1', label: '2026-2027' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getRepositoryToken(Enrollment), useValue: enrollmentRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(AcademicYear), useValue: yearRepo },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  /**
   * Chaque appel du service crée un nouveau query builder : on ne peut pas
   * enchaîner les réponses sur un seul. On en fabrique un par requête.
   */
  const withSequences = (enrollmentSeq: any[], paymentSeq: any[]) => {
    let e = 0;
    let p = 0;
    enrollmentRepo.createQueryBuilder.mockImplementation(() =>
      queueOf([enrollmentSeq[e++]]),
    );
    paymentRepo.createQueryBuilder.mockImplementation(() =>
      queueOf([paymentSeq[p++]]),
    );
  };

  describe('garde-fous', () => {
    it('exige un établissement résolu', async () => {
      await expect(service.getStats('')).rejects.toThrow(ForbiddenException);
    });

    it('rend un tableau à zéro plutôt qu’une erreur sans année configurée', async () => {
      yearRepo.findOne.mockResolvedValue(null);

      const stats = await service.getStats('school-1');
      expect(stats.academicYear).toBeNull();
      expect(stats.enrollments.total).toBe(0);
      expect(stats.finance.recoveryRate).toBe(0);
      expect(stats.byClassRoom).toEqual([]);
    });

    it('initialise tous les statuts à zéro, même absents des résultats', async () => {
      yearRepo.findOne.mockResolvedValue(null);

      // L'écran affiche une ligne par statut : une clé manquante y produirait
      // « undefined ».
      const stats = await service.getStats('school-1');
      for (const status of Object.values(EnrollmentStatus)) {
        expect(stats.enrollments.byStatus[status]).toBe(0);
      }
      for (const method of Object.values(PaymentMethod)) {
        expect(stats.finance.byMethod[method]).toBe(0);
      }
    });

    it('retient l’année active par défaut', async () => {
      withSequences([[], {}, []], [[], {}, []]);

      await service.getStats('school-1');
      expect(yearRepo.findOne).toHaveBeenCalledWith({
        where: { schoolId: 'school-1', isActive: true },
      });
    });

    it('retient l’année demandée quand elle est fournie', async () => {
      withSequences([[], {}, []], [[], {}, []]);

      await service.getStats('school-1', 'year-2');
      expect(yearRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'year-2', schoolId: 'school-1' },
      });
    });
  });

  describe('agrégats', () => {
    it('totalise les dossiers par statut', async () => {
      withSequences(
        [
          [
            { status: EnrollmentStatus.ENROLLED, count: '30' },
            { status: EnrollmentStatus.PARTIALLY_PAID, count: '12' },
          ],
          { totalDue: '0' },
          [],
        ],
        [[], { amount: '0' }, []],
      );

      const stats = await service.getStats('school-1');
      expect(stats.enrollments.total).toBe(42);
      expect(stats.enrollments.byStatus[EnrollmentStatus.ENROLLED]).toBe(30);
      expect(stats.enrollments.byStatus[EnrollmentStatus.EXPIRED]).toBe(0);
    });

    it('calcule le taux de recouvrement', async () => {
      withSequences(
        [[], { totalDue: '1000000' }, []],
        [[{ method: PaymentMethod.CASH, amount: '750000' }], { amount: '0' }, []],
      );

      const stats = await service.getStats('school-1');
      expect(stats.finance.totalDue).toBe(1000000);
      expect(stats.finance.totalCollected).toBe(750000);
      expect(stats.finance.outstanding).toBe(250000);
      expect(stats.finance.recoveryRate).toBe(75);
    });

    it('évite la division par zéro quand rien n’est dû', async () => {
      withSequences([[], { totalDue: '0' }, []], [[], { amount: '0' }, []]);

      const stats = await service.getStats('school-1');
      expect(stats.finance.recoveryRate).toBe(0);
    });

    it('ne rend jamais un reste à recouvrer négatif', async () => {
      withSequences(
        [[], { totalDue: '100000' }, []],
        [[{ method: PaymentMethod.CASH, amount: '120000' }], { amount: '0' }, []],
      );

      const stats = await service.getStats('school-1');
      expect(stats.finance.outstanding).toBe(0);
    });

    it('ventile les encaissements par mode de règlement', async () => {
      withSequences(
        [[], { totalDue: '0' }, []],
        [
          [
            { method: PaymentMethod.CASH, amount: '400000' },
            { method: PaymentMethod.MOBILE_MONEY, amount: '350000' },
          ],
          { amount: '0' },
          [],
        ],
      );

      const stats = await service.getStats('school-1');
      expect(stats.finance.byMethod[PaymentMethod.CASH]).toBe(400000);
      expect(stats.finance.byMethod[PaymentMethod.MOBILE_MONEY]).toBe(350000);
      expect(stats.finance.totalCollected).toBe(750000);
    });

    it('remonte les encaissements du jour', async () => {
      withSequences([[], { totalDue: '0' }, []], [[], { amount: '85000' }, []]);

      const stats = await service.getStats('school-1');
      expect(stats.finance.collectedToday).toBe(85000);
    });

    it('tolère un agrégat vide', async () => {
      withSequences([[], undefined, []], [[], undefined, []]);

      const stats = await service.getStats('school-1');
      expect(stats.finance.totalDue).toBe(0);
      expect(stats.finance.collectedToday).toBe(0);
    });
  });

  describe('détail par classe', () => {
    it('rapproche montants dus et encaissés classe par classe', async () => {
      withSequences(
        [
          [],
          { totalDue: '0' },
          [
            {
              classRoomId: 'c1',
              name: '6ème A',
              enrollmentCount: '30',
              totalDue: '3000000',
            },
          ],
        ],
        [[], { amount: '0' }, [{ classRoomId: 'c1', collected: '1800000' }]],
      );

      const stats = await service.getStats('school-1');
      expect(stats.byClassRoom[0]).toEqual({
        classRoomId: 'c1',
        name: '6ème A',
        enrollmentCount: 30,
        totalDue: 3000000,
        collected: 1800000,
        outstanding: 1200000,
      });
    });

    it('affiche une classe sans encaissement plutôt que de l’omettre', async () => {
      withSequences(
        [
          [],
          { totalDue: '0' },
          [
            {
              classRoomId: 'c1',
              name: '6ème A',
              enrollmentCount: '30',
              totalDue: '3000000',
            },
          ],
        ],
        [[], { amount: '0' }, []],
      );

      // C'est justement la classe qui n'a rien versé que la direction cherche.
      const stats = await service.getStats('school-1');
      expect(stats.byClassRoom[0].collected).toBe(0);
      expect(stats.byClassRoom[0].outstanding).toBe(3000000);
    });

    it('classe les classes par reste à recouvrer décroissant', async () => {
      withSequences(
        [
          [],
          { totalDue: '0' },
          [
            { classRoomId: 'c1', name: '6ème A', enrollmentCount: '1', totalDue: '100' },
            { classRoomId: 'c2', name: '5ème A', enrollmentCount: '1', totalDue: '900' },
            { classRoomId: 'c3', name: '4ème A', enrollmentCount: '1', totalDue: '500' },
          ],
        ],
        [[], { amount: '0' }, []],
      );

      const stats = await service.getStats('school-1');
      expect(stats.byClassRoom.map((c) => c.name)).toEqual([
        '5ème A',
        '4ème A',
        '6ème A',
      ]);
    });

    it('ne rend jamais un reste négatif par classe', async () => {
      withSequences(
        [
          [],
          { totalDue: '0' },
          [
            { classRoomId: 'c1', name: '6ème A', enrollmentCount: '1', totalDue: '100' },
          ],
        ],
        [[], { amount: '0' }, [{ classRoomId: 'c1', collected: '150' }]],
      );

      const stats = await service.getStats('school-1');
      expect(stats.byClassRoom[0].outstanding).toBe(0);
    });
  });
});
