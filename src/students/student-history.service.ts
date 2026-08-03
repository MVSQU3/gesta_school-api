import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AbsencesService } from '../absences/absences.service';
import { BalanceService, EnrollmentBalance } from '../common/balance/balance.service';
import { BulletinsService } from '../bulletins/bulletins.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Student } from './entities/student.entity';

/** Résultat de l'élève sur une période de notation. */
export interface HistoryPeriod {
  gradingPeriodId: string;
  label: string;
  sequence: number;
  isClosed: boolean;
  /** Moyenne générale sur 20. `null` si aucune note n'a été saisie. */
  average: number | null;
  rank: number | null;
  classSize: number;
  absences: { justified: number; unjustified: number };
}

/** Versement rattaché à un dossier, annulations comprises. */
export interface HistoryPayment {
  id: string;
  receiptNumber: string;
  amount: number;
  method: string;
  paidAt: Date;
  cancelledAt: Date | null;
  cancellationType: string | null;
  cancellationReason: string | null;
  receivedBy: string | null;
}

/** Une année de scolarité de l'élève. */
export interface HistoryEnrollment {
  id: string;
  reference: string;
  status: string;
  academicYear: { id: string; label: string; isActive: boolean };
  classRoom: { id: string; name: string } | null;
  createdAt: Date;
  balance: EnrollmentBalance;
  payments: HistoryPayment[];
  periods: HistoryPeriod[];
}

export interface StudentHistory {
  student: Student;
  enrollments: HistoryEnrollment[];
  /** Cumuls sur toute la scolarité dans l'établissement. */
  totals: {
    years: number;
    totalDue: number;
    totalPaid: number;
    balance: number;
    absences: { justified: number; unjustified: number };
  };
}

/**
 * Dossier complet d'un élève : sa scolarité année par année, avec la situation
 * financière de chaque inscription, le détail des versements et les résultats
 * par période.
 *
 * Service distinct de `StudentsService` : il n'est utilisé que par l'écran de
 * consultation, et il dépend des bulletins, des absences et de la caisse — des
 * dépendances qu'on ne veut pas imposer au service qui sert le tunnel
 * d'inscription, sollicité lui à chaque saisie.
 */
@Injectable()
export class StudentHistoryService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(GradingPeriod)
    private readonly periodRepository: Repository<GradingPeriod>,
    private readonly balanceService: BalanceService,
    private readonly bulletinsService: BulletinsService,
    private readonly absencesService: AbsencesService,
  ) {}

  async getHistory(studentId: string, schoolId: string): Promise<StudentHistory> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const student = await this.studentRepository.findOne({
      where: { id: studentId, schoolId },
    });
    if (!student) {
      throw new NotFoundException(`Élève introuvable (${studentId}).`);
    }

    const enrollments = await this.enrollmentRepository.find({
      where: { studentId, schoolId },
      relations: { classRoom: true, academicYear: true },
      order: { createdAt: 'DESC' },
    });

    // Un seul aller-retour pour tous les versements de l'élève : une requête
    // par dossier serait inutilement bavarde sur un élève ayant plusieurs
    // années de scolarité.
    const payments = enrollments.length
      ? await this.paymentRepository.find({
          where: { enrollmentId: In(enrollments.map((e) => e.id)) },
          relations: { receivedByUser: true },
          order: { paidAt: 'ASC' },
        })
      : [];

    const paymentsByEnrollment = new Map<string, HistoryPayment[]>();
    for (const p of payments) {
      const list = paymentsByEnrollment.get(p.enrollmentId) ?? [];
      list.push({
        id: p.id,
        receiptNumber: p.receiptNumber,
        amount: Number(p.amount),
        method: p.method,
        paidAt: p.paidAt,
        cancelledAt: p.cancelledAt,
        cancellationType: p.cancellationType,
        cancellationReason: p.cancellationReason,
        receivedBy: p.receivedByUser?.email ?? null,
      });
      paymentsByEnrollment.set(p.enrollmentId, list);
    }

    const result: HistoryEnrollment[] = [];
    const totals = {
      years: enrollments.length,
      totalDue: 0,
      totalPaid: 0,
      balance: 0,
      absences: { justified: 0, unjustified: 0 },
    };

    for (const enrollment of enrollments) {
      const balance = await this.balanceService.compute(enrollment);
      const periods = await this.buildPeriods(schoolId, enrollment);

      totals.totalDue += balance.totalDue;
      totals.totalPaid += balance.amountPaid;
      totals.balance += balance.balance;
      for (const p of periods) {
        totals.absences.justified += p.absences.justified;
        totals.absences.unjustified += p.absences.unjustified;
      }

      result.push({
        id: enrollment.id,
        reference: enrollment.reference,
        status: enrollment.status,
        academicYear: {
          id: enrollment.academicYearId,
          label: enrollment.academicYear?.label ?? '—',
          isActive: enrollment.academicYear?.isActive ?? false,
        },
        classRoom: enrollment.classRoom
          ? { id: enrollment.classRoom.id, name: enrollment.classRoom.name }
          : null,
        createdAt: enrollment.createdAt,
        balance,
        payments: paymentsByEnrollment.get(enrollment.id) ?? [],
        periods,
      });
    }

    return { student, enrollments: result, totals };
  }

  /**
   * Résultats de l'élève sur chaque période de l'année du dossier.
   *
   * La moyenne et le rang sont repris du calcul des bulletins plutôt que
   * recalculés ici : deux implémentations du même calcul finiraient par
   * diverger, et c'est le bulletin qui fait foi. Une période sans aucune note
   * ne fait pas échouer l'historique — elle apparaît simplement sans moyenne,
   * ce qui est le cas normal d'une année en cours.
   */
  private async buildPeriods(
    schoolId: string,
    enrollment: Enrollment,
  ): Promise<HistoryPeriod[]> {
    const periods = await this.periodRepository.find({
      where: { schoolId, academicYearId: enrollment.academicYearId },
      order: { sequence: 'ASC' },
    });

    const rows: HistoryPeriod[] = [];

    for (const period of periods) {
      const absencesMap = await this.absencesService.countByPeriod(
        schoolId,
        [enrollment.id],
        period.id,
      );
      const absences = absencesMap.get(enrollment.id) ?? {
        justified: 0,
        unjustified: 0,
      };

      let average: number | null = null;
      let rank: number | null = null;
      let classSize = 0;

      try {
        const { bulletin } = await this.bulletinsService.getStudentBulletin(
          schoolId,
          enrollment.id,
          period.id,
        );
        average = bulletin.average;
        rank = bulletin.rank;
        classSize = bulletin.classSize;
      } catch {
        // Pas de bulletin sur cette période : aucune note saisie, ou dossier
        // exclu du calcul. La période reste listée, sans moyenne.
      }

      rows.push({
        gradingPeriodId: period.id,
        label: period.label,
        sequence: period.sequence,
        isClosed: period.isClosed,
        average,
        rank,
        classSize,
        absences,
      });
    }

    return rows;
  }
}
