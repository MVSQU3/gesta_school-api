import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import { Payment, PaymentMethod } from '../payments/entities/payment.entity';

export interface DashboardStats {
  /** Année scolaire sur laquelle porte l'ensemble des chiffres. */
  academicYear: { id: string; label: string } | null;
  enrollments: {
    total: number;
    byStatus: Record<EnrollmentStatus, number>;
  };
  finance: {
    /** Somme des montants dus sur les dossiers non expirés. */
    totalDue: number;
    /** Somme des versements encaissés. */
    totalCollected: number;
    /** Reste à recouvrer. */
    outstanding: number;
    /** Taux de recouvrement en pourcentage (0 si rien n'est dû). */
    recoveryRate: number;
    /** Encaissements de la journée en cours. */
    collectedToday: number;
    byMethod: Record<PaymentMethod, number>;
  };
  /** Détail par classe, trié par reste à recouvrer décroissant. */
  byClassRoom: Array<{
    classRoomId: string;
    name: string;
    enrollmentCount: number;
    totalDue: number;
    collected: number;
    outstanding: number;
  }>;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepository: Repository<AcademicYear>,
  ) {}

  /**
   * Statistiques consolidées d'un établissement pour une année scolaire.
   *
   * Sans `academicYearId`, l'année active est utilisée. Les dossiers expirés
   * sont comptés mais exclus des montants dus : ce sont des dossiers abandonnés,
   * les intégrer gonflerait artificiellement le reste à recouvrer.
   */
  async getStats(
    schoolId: string,
    academicYearId?: string,
  ): Promise<DashboardStats> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const year = academicYearId
      ? await this.academicYearRepository.findOne({
          where: { id: academicYearId, schoolId },
        })
      : await this.academicYearRepository.findOne({
          where: { schoolId, isActive: true },
        });

    // Sans année scolaire configurée, le tableau de bord reste affichable à zéro
    if (!year) {
      return this.emptyStats();
    }

    const scope = { schoolId, academicYearId: year.id };

    // --- Répartition des dossiers par statut ---
    const statusRows = await this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .select('enrollment.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('enrollment.schoolId = :schoolId', scope)
      .andWhere('enrollment.academicYearId = :academicYearId', scope)
      .groupBy('enrollment.status')
      .getRawMany<{ status: EnrollmentStatus; count: string }>();

    const byStatus = Object.values(EnrollmentStatus).reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as Record<EnrollmentStatus, number>,
    );
    let total = 0;
    for (const row of statusRows) {
      byStatus[row.status] = Number(row.count);
      total += Number(row.count);
    }

    // --- Montant total dû (hors dossiers expirés) ---
    const dueRow = await this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .select('COALESCE(SUM(enrollment.totalDue), 0)', 'totalDue')
      .where('enrollment.schoolId = :schoolId', scope)
      .andWhere('enrollment.academicYearId = :academicYearId', scope)
      .andWhere('enrollment.status != :expired', {
        expired: EnrollmentStatus.EXPIRED,
      })
      .getRawOne<{ totalDue: string }>();

    const totalDue = Number(dueRow?.totalDue ?? 0);

    // --- Encaissements, ventilés par mode ---
    const methodRows = await this.paymentRepository
      .createQueryBuilder('payment')
      .innerJoin('payment.enrollment', 'enrollment')
      .select('payment.method', 'method')
      .addSelect('COALESCE(SUM(payment.amount), 0)', 'amount')
      .where('payment.schoolId = :schoolId', scope)
      .andWhere('enrollment.academicYearId = :academicYearId', scope)
      .andWhere('payment.cancelledAt IS NULL')
      .groupBy('payment.method')
      .getRawMany<{ method: PaymentMethod; amount: string }>();

    const byMethod = Object.values(PaymentMethod).reduce(
      (acc, method) => ({ ...acc, [method]: 0 }),
      {} as Record<PaymentMethod, number>,
    );
    let totalCollected = 0;
    for (const row of methodRows) {
      byMethod[row.method] = Number(row.amount);
      totalCollected += Number(row.amount);
    }

    // --- Encaissements du jour ---
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    const todayRow = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'amount')
      .where('payment.schoolId = :schoolId', { schoolId })
      .andWhere('payment.paidAt BETWEEN :start AND :end', {
        start: startOfDay,
        end: endOfDay,
      })
      .andWhere('payment.cancelledAt IS NULL')
      .getRawOne<{ amount: string }>();

    // --- Détail par classe ---
    // Deux agrégats séparés plutôt qu'une jointure unique : joindre les
    // paiements dans la même requête dupliquerait les lignes d'inscription
    // et gonflerait la somme des montants dus.
    const dueByClass = await this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .innerJoin('enrollment.classRoom', 'classRoom')
      .select('classRoom.id', 'classRoomId')
      .addSelect('classRoom.name', 'name')
      .addSelect('COUNT(enrollment.id)', 'enrollmentCount')
      .addSelect('COALESCE(SUM(enrollment.totalDue), 0)', 'totalDue')
      .where('enrollment.schoolId = :schoolId', scope)
      .andWhere('enrollment.academicYearId = :academicYearId', scope)
      .andWhere('enrollment.status != :expired', {
        expired: EnrollmentStatus.EXPIRED,
      })
      .groupBy('classRoom.id')
      .addGroupBy('classRoom.name')
      .getRawMany<{
        classRoomId: string;
        name: string;
        enrollmentCount: string;
        totalDue: string;
      }>();

    const collectedByClass = await this.paymentRepository
      .createQueryBuilder('payment')
      .innerJoin('payment.enrollment', 'enrollment')
      .select('enrollment.classRoomId', 'classRoomId')
      .addSelect('COALESCE(SUM(payment.amount), 0)', 'collected')
      .where('enrollment.schoolId = :schoolId', scope)
      .andWhere('enrollment.academicYearId = :academicYearId', scope)
      .andWhere('enrollment.status != :expired', {
        expired: EnrollmentStatus.EXPIRED,
      })
      .andWhere('payment.cancelledAt IS NULL')
      .groupBy('enrollment.classRoomId')
      .getRawMany<{ classRoomId: string; collected: string }>();

    const collectedMap = new Map(
      collectedByClass.map((row) => [row.classRoomId, Number(row.collected)]),
    );

    const byClassRoom = dueByClass
      .map((row) => {
        const due = Number(row.totalDue);
        const collected = collectedMap.get(row.classRoomId) ?? 0;
        return {
          classRoomId: row.classRoomId,
          name: row.name,
          enrollmentCount: Number(row.enrollmentCount),
          totalDue: due,
          collected,
          outstanding: Math.max(due - collected, 0),
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding);

    return {
      academicYear: { id: year.id, label: year.label },
      enrollments: { total, byStatus },
      finance: {
        totalDue,
        totalCollected,
        outstanding: Math.max(totalDue - totalCollected, 0),
        recoveryRate:
          totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0,
        collectedToday: Number(todayRow?.amount ?? 0),
        byMethod,
      },
      byClassRoom,
    };
  }

  private emptyStats(): DashboardStats {
    return {
      academicYear: null,
      enrollments: {
        total: 0,
        byStatus: Object.values(EnrollmentStatus).reduce(
          (acc, s) => ({ ...acc, [s]: 0 }),
          {} as Record<EnrollmentStatus, number>,
        ),
      },
      finance: {
        totalDue: 0,
        totalCollected: 0,
        outstanding: 0,
        recoveryRate: 0,
        collectedToday: 0,
        byMethod: Object.values(PaymentMethod).reduce(
          (acc, m) => ({ ...acc, [m]: 0 }),
          {} as Record<PaymentMethod, number>,
        ),
      },
      byClassRoom: [],
    };
  }
}
