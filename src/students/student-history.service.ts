import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AbsencesService } from '../absences/absences.service';
import { BalanceService, EnrollmentBalance } from '../common/balance/balance.service';
import { BulletinsService } from '../bulletins/bulletins.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { HalfDay } from '../absences/entities/absence.entity';
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
  /** Détail par matière, tel qu'il figure au bulletin. */
  subjects: {
    name: string;
    coefficient: number;
    average: number | null;
    classAverage: number | null;
  }[];
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

/** Une absence datée, pour le relevé d'assiduité. */
export interface HistoryAbsence {
  id: string;
  date: Date;
  halfDay: HalfDay;
  isJustified: boolean;
  reason: string | null;
}

/** Scolarité de l'élève sur UNE année. */
export interface HistoryEnrollment {
  id: string;
  reference: string;
  status: string;
  academicYear: { id: string; label: string; isActive: boolean };
  classRoom: { id: string; name: string } | null;
  createdAt: Date;
  expiresAt: Date;
  balance: EnrollmentBalance;
  payments: HistoryPayment[];
  periods: HistoryPeriod[];
  absences: HistoryAbsence[];
}

/** Année où l'élève possède un dossier, pour le sélecteur. */
export interface StudentYearOption {
  id: string;
  label: string;
  isActive: boolean;
  enrollmentId: string;
  status: string;
  className: string | null;
}

export interface StudentFile {
  student: Student;
  /** Années où l'élève a été inscrit, de la plus récente à la plus ancienne. */
  availableYears: StudentYearOption[];
  selectedYear: { id: string; label: string; isActive: boolean } | null;
  /** Dossier de l'année retenue. `null` si l'élève n'y est pas inscrit. */
  enrollment: HistoryEnrollment | null;
  /** Cumuls financiers sur toute la scolarité, toutes années confondues. */
  totals: {
    years: number;
    totalDue: number;
    totalPaid: number;
    balance: number;
  };
}

/**
 * Dossier d'un élève, cadré sur une année scolaire.
 *
 * Le détail lourd — bulletins, versements, assiduité — n'est produit que pour
 * l'année demandée, l'année active par défaut. Charger toute la scolarité
 * d'office reviendrait à recalculer les bulletins de la classe entière pour
 * chaque période de chaque année : un élève de terminale déclencherait une
 * douzaine de calculs de classe pour un écran qui n'en affiche qu'un.
 *
 * Les autres années restent listées — c'est le sélecteur — et leurs cumuls
 * financiers sont agrégés, ce qui ne coûte qu'une requête par dossier.
 *
 * Service distinct de `StudentsService` : il dépend des bulletins, des absences
 * et de la caisse, dépendances qu'on ne veut pas imposer au service qui sert le
 * tunnel d'inscription, sollicité lui à chaque saisie.
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

  async getHistory(
    studentId: string,
    schoolId: string,
    academicYearId?: string,
  ): Promise<StudentFile> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const student = await this.studentRepository.findOne({
      where: { id: studentId, schoolId },
    });
    if (!student) {
      throw new NotFoundException(`Élève introuvable (${studentId}).`);
    }

    // Toutes les inscriptions, mais sans le détail : cette liste sert au
    // sélecteur d'année et aux cumuls, pas à l'affichage détaillé.
    const enrollments = await this.enrollmentRepository.find({
      where: { studentId, schoolId },
      relations: { classRoom: true, academicYear: true },
      order: { createdAt: 'DESC' },
    });

    const availableYears: StudentYearOption[] = enrollments.map((e) => ({
      id: e.academicYearId,
      label: e.academicYear?.label ?? '—',
      isActive: e.academicYear?.isActive ?? false,
      enrollmentId: e.id,
      status: e.status,
      className: e.classRoom?.name ?? null,
    }));

    // Cumuls sur toute la scolarité : une requête d'agrégat par dossier,
    // sans toucher aux bulletins.
    const totals = {
      years: enrollments.length,
      totalDue: 0,
      totalPaid: 0,
      balance: 0,
    };
    const balances = new Map<string, EnrollmentBalance>();
    for (const enrollment of enrollments) {
      const balance = await this.balanceService.compute(enrollment);
      balances.set(enrollment.id, balance);
      totals.totalDue += balance.totalDue;
      totals.totalPaid += balance.amountPaid;
      totals.balance += balance.balance;
    }

    /**
     * Année retenue : celle demandée, sinon l'année active de l'établissement.
     * Si l'élève n'y a pas de dossier, on ne bascule pas silencieusement sur
     * une autre année — l'écran affiche « non inscrit » et laisse le choix,
     * plutôt que de montrer des données d'une année que personne n'a demandée.
     */
    const target = academicYearId
      ? enrollments.find((e) => e.academicYearId === academicYearId)
      : enrollments.find((e) => e.academicYear?.isActive);

    const selectedYear = target
      ? {
          id: target.academicYearId,
          label: target.academicYear?.label ?? '—',
          isActive: target.academicYear?.isActive ?? false,
        }
      : null;

    if (!target) {
      return { student, availableYears, selectedYear: null, enrollment: null, totals };
    }

    const payments = await this.paymentRepository.find({
      where: { enrollmentId: target.id },
      relations: { receivedByUser: true },
      order: { paidAt: 'ASC' },
    });

    const absences = await this.absencesService.findByEnrollment(
      target.id,
      schoolId,
    );

    const enrollment: HistoryEnrollment = {
      id: target.id,
      reference: target.reference,
      status: target.status,
      academicYear: selectedYear as { id: string; label: string; isActive: boolean },
      classRoom: target.classRoom
        ? { id: target.classRoom.id, name: target.classRoom.name }
        : null,
      createdAt: target.createdAt,
      expiresAt: target.expiresAt,
      balance: balances.get(target.id) as EnrollmentBalance,
      payments: payments.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        amount: Number(p.amount),
        method: p.method,
        paidAt: p.paidAt,
        cancelledAt: p.cancelledAt,
        cancellationType: p.cancellationType,
        cancellationReason: p.cancellationReason,
        receivedBy: p.receivedByUser?.email ?? null,
      })),
      periods: await this.buildPeriods(schoolId, target),
      absences: absences.map((a) => ({
        id: a.id,
        date: a.date,
        halfDay: a.halfDay,
        isJustified: a.isJustified,
        reason: a.reason,
      })),
    };

    return { student, availableYears, selectedYear, enrollment, totals };
  }

  /**
   * Résultats de l'élève sur chaque période de l'année du dossier.
   *
   * La moyenne, le rang et le détail par matière sont repris du calcul des
   * bulletins plutôt que recalculés ici : deux implémentations du même calcul
   * finiraient par diverger, et c'est le bulletin qui fait foi. Une période
   * sans aucune note ne fait pas échouer le dossier — elle apparaît sans
   * moyenne, ce qui est le cas normal d'une année en cours.
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
      let subjects: HistoryPeriod['subjects'] = [];

      try {
        const { bulletin } = await this.bulletinsService.getStudentBulletin(
          schoolId,
          enrollment.id,
          period.id,
        );
        average = bulletin.average;
        rank = bulletin.rank;
        classSize = bulletin.classSize;
        subjects = bulletin.subjects.map((s) => ({
          name: s.name,
          coefficient: s.coefficient,
          average: s.average,
          classAverage: s.classAverage,
        }));
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
        subjects,
        absences,
      });
    }

    return rows;
  }
}
