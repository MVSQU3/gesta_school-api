import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AbsencesService } from '../absences/absences.service';
import { BulletinsService } from '../bulletins/bulletins.service';
import { BalanceService } from '../common/balance/balance.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Student } from './entities/student.entity';
import { StudentHistoryService } from './student-history.service';

/**
 * Le dossier élève est cadré sur une année : charger toute la scolarité
 * d'office recalculerait les bulletins de la classe entière pour chaque
 * période de chaque année. Les tests portent autant sur ce qui est renvoyé
 * que sur ce qui n'est délibérément pas chargé.
 */
describe('StudentHistoryService (dossier élève)', () => {
  let service: StudentHistoryService;
  let repos: Record<string, any>;
  let balance: any;
  let bulletins: any;
  let absences: any;

  const STUDENT = { id: 'student-1', schoolId: 'school-1', lastName: 'Kone' };

  const enrollment = (overrides: any = {}) => ({
    id: 'enr-active',
    schoolId: 'school-1',
    studentId: 'student-1',
    reference: 'INS-CMB-26-0002',
    status: 'ENROLLED',
    academicYearId: 'year-active',
    academicYear: { id: 'year-active', label: '2026-2027', isActive: true },
    classRoom: { id: 'class-1', name: '4ème A' },
    createdAt: new Date(),
    expiresAt: new Date(),
    ...overrides,
  });

  const pastEnrollment = () =>
    enrollment({
      id: 'enr-past',
      reference: 'INS-CMB-26-0001',
      academicYearId: 'year-past',
      academicYear: { id: 'year-past', label: '2025-2026', isActive: false },
      classRoom: { id: 'class-0', name: '5ème A' },
    });

  const balanceOf = (totalDue: number, amountPaid: number) => ({
    totalDue,
    amountPaid,
    balance: Math.max(totalDue - amountPaid, 0),
    isFullyPaid: amountPaid >= totalDue,
    status: 'ENROLLED',
  });

  beforeEach(async () => {
    repos = {
      student: { findOne: jest.fn().mockResolvedValue(STUDENT) },
      enrollment: { find: jest.fn().mockResolvedValue([]) },
      payment: { find: jest.fn().mockResolvedValue([]) },
      period: { find: jest.fn().mockResolvedValue([]) },
    };
    balance = { compute: jest.fn().mockResolvedValue(balanceOf(100000, 40000)) };
    bulletins = { getStudentBulletin: jest.fn() };
    absences = {
      findByEnrollment: jest.fn().mockResolvedValue([]),
      countByPeriod: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentHistoryService,
        { provide: getRepositoryToken(Student), useValue: repos.student },
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
        { provide: getRepositoryToken(Payment), useValue: repos.payment },
        { provide: getRepositoryToken(GradingPeriod), useValue: repos.period },
        { provide: BalanceService, useValue: balance },
        { provide: BulletinsService, useValue: bulletins },
        { provide: AbsencesService, useValue: absences },
      ],
    }).compile();

    service = module.get<StudentHistoryService>(StudentHistoryService);
  });

  describe('garde-fous', () => {
    it('exige un établissement résolu', async () => {
      await expect(service.getHistory('student-1', '')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuse un élève d’un autre établissement', async () => {
      repos.student.findOne.mockResolvedValue(null);

      await expect(
        service.getHistory('student-1', 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('choix de l’année', () => {
    beforeEach(() =>
      repos.enrollment.find.mockResolvedValue([enrollment(), pastEnrollment()]),
    );

    it('retient l’année active par défaut', async () => {
      const file = await service.getHistory('student-1', 'school-1');

      expect(file.selectedYear?.label).toBe('2026-2027');
      expect(file.enrollment?.reference).toBe('INS-CMB-26-0002');
    });

    it('charge l’année demandée quand elle est précisée', async () => {
      const file = await service.getHistory('student-1', 'school-1', 'year-past');

      expect(file.selectedYear?.label).toBe('2025-2026');
      expect(file.enrollment?.reference).toBe('INS-CMB-26-0001');
    });

    it('ne charge le détail que de l’année retenue', async () => {
      await service.getHistory('student-1', 'school-1');

      // Une seule inscription est détaillée, pas les deux : c'est ce qui évite
      // de recalculer les bulletins de toutes les années.
      expect(repos.payment.find).toHaveBeenCalledTimes(1);
      expect(repos.payment.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enrollmentId: 'enr-active' } }),
      );
    });

    it('liste toutes les années pour le sélecteur', async () => {
      const file = await service.getHistory('student-1', 'school-1');

      expect(file.availableYears.map((y) => y.label)).toEqual([
        '2026-2027',
        '2025-2026',
      ]);
      expect(file.availableYears.map((y) => y.className)).toEqual([
        '4ème A',
        '5ème A',
      ]);
    });

    it('ne bascule pas en silence quand l’élève n’a pas de dossier cette année', async () => {
      repos.enrollment.find.mockResolvedValue([pastEnrollment()]);

      // Afficher les notes de l'an dernier sous l'étiquette de cette année
      // ferait prendre une décision sur de mauvaises données.
      const file = await service.getHistory('student-1', 'school-1');
      expect(file.selectedYear).toBeNull();
      expect(file.enrollment).toBeNull();
      expect(file.availableYears).toHaveLength(1);
    });

    it('rend un dossier vide pour un élève jamais inscrit', async () => {
      repos.enrollment.find.mockResolvedValue([]);

      const file = await service.getHistory('student-1', 'school-1');
      expect(file.availableYears).toEqual([]);
      expect(file.totals.years).toBe(0);
    });
  });

  describe('cumuls sur toute la scolarité', () => {
    it('additionne les soldes de toutes les années', async () => {
      repos.enrollment.find.mockResolvedValue([enrollment(), pastEnrollment()]);
      balance.compute
        .mockResolvedValueOnce(balanceOf(100000, 40000))
        .mockResolvedValueOnce(balanceOf(90000, 90000));

      const file = await service.getHistory('student-1', 'school-1');
      expect(file.totals).toEqual({
        years: 2,
        totalDue: 190000,
        totalPaid: 130000,
        balance: 60000,
      });
    });

    it('n’appelle pas les bulletins pour les années non affichées', async () => {
      repos.enrollment.find.mockResolvedValue([enrollment(), pastEnrollment()]);

      await service.getHistory('student-1', 'school-1');

      // Les cumuls ne coûtent qu'une requête d'agrégat par dossier.
      expect(balance.compute).toHaveBeenCalledTimes(2);
      expect(bulletins.getStudentBulletin).not.toHaveBeenCalled();
    });
  });

  describe('détail de l’année retenue', () => {
    beforeEach(() => {
      repos.enrollment.find.mockResolvedValue([enrollment()]);
      repos.period.find.mockResolvedValue([
        { id: 'p1', label: '1er Trimestre', sequence: 1, isClosed: false },
      ]);
    });

    it('reprend moyenne, rang et détail par matière du bulletin', async () => {
      bulletins.getStudentBulletin.mockResolvedValue({
        bulletin: {
          average: 14,
          rank: 3,
          classSize: 40,
          subjects: [
            {
              name: 'Mathématiques',
              coefficient: 4,
              average: 15,
              classAverage: 12,
            },
          ],
        },
      });

      const file = await service.getHistory('student-1', 'school-1');
      const period = file.enrollment!.periods[0];
      expect(period.average).toBe(14);
      expect(period.rank).toBe(3);
      expect(period.subjects[0].name).toBe('Mathématiques');
    });

    it('laisse une période sans note visible mais sans moyenne', async () => {
      bulletins.getStudentBulletin.mockRejectedValue(new Error('aucune note'));

      // C'est le cas normal d'une année en cours : la période reste listée.
      const file = await service.getHistory('student-1', 'school-1');
      expect(file.enrollment!.periods).toHaveLength(1);
      expect(file.enrollment!.periods[0].average).toBeNull();
    });

    it('compte les absences de chaque période', async () => {
      bulletins.getStudentBulletin.mockRejectedValue(new Error('x'));
      absences.countByPeriod.mockResolvedValue(
        new Map([['enr-active', { justified: 1, unjustified: 2 }]]),
      );

      const file = await service.getHistory('student-1', 'school-1');
      expect(file.enrollment!.periods[0].absences).toEqual({
        justified: 1,
        unjustified: 2,
      });
    });

    it('affiche zéro absence quand aucune n’est relevée', async () => {
      bulletins.getStudentBulletin.mockRejectedValue(new Error('x'));

      const file = await service.getHistory('student-1', 'school-1');
      expect(file.enrollment!.periods[0].absences).toEqual({
        justified: 0,
        unjustified: 0,
      });
    });

    it('nomme le caissier de chaque versement', async () => {
      bulletins.getStudentBulletin.mockRejectedValue(new Error('x'));
      repos.payment.find.mockResolvedValue([
        {
          id: 'pay-1',
          receiptNumber: 'REC-CMB-26-0001',
          amount: '40000',
          method: 'CASH',
          paidAt: new Date(),
          cancelledAt: null,
          cancellationType: null,
          cancellationReason: null,
          receivedByUser: { email: 'caisse@ecole.ci' },
        },
      ]);

      const file = await service.getHistory('student-1', 'school-1');
      expect(file.enrollment!.payments[0].receivedBy).toBe('caisse@ecole.ci');
      expect(file.enrollment!.payments[0].amount).toBe(40000);
    });

    it('tolère un versement dont le caissier a été supprimé', async () => {
      bulletins.getStudentBulletin.mockRejectedValue(new Error('x'));
      repos.payment.find.mockResolvedValue([
        {
          id: 'pay-1',
          receiptNumber: 'REC-CMB-26-0001',
          amount: 40000,
          method: 'CASH',
          paidAt: new Date(),
          cancelledAt: null,
          cancellationType: null,
          cancellationReason: null,
          receivedByUser: null,
        },
      ]);

      const file = await service.getHistory('student-1', 'school-1');
      expect(file.enrollment!.payments[0].receivedBy).toBeNull();
    });

    it('joint le relevé d’assiduité daté', async () => {
      bulletins.getStudentBulletin.mockRejectedValue(new Error('x'));
      absences.findByEnrollment.mockResolvedValue([
        {
          id: 'abs-1',
          date: new Date('2026-10-06'),
          halfDay: 'MORNING',
          isJustified: true,
          reason: 'Rendez-vous médical',
        },
      ]);

      const file = await service.getHistory('student-1', 'school-1');
      expect(file.enrollment!.absences).toHaveLength(1);
      expect(file.enrollment!.absences[0].isJustified).toBe(true);
    });
  });
});
