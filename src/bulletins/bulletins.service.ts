import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AbsencesService } from '../absences/absences.service';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import { Grade } from '../evaluations/entities/grade.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { ClassRoomSubject } from '../subjects/entities/classroom-subject.entity';

export interface SubjectResult {
  subjectId: string;
  name: string;
  shortName: string | null;
  coefficient: number;
  /** Moyenne de l'élève dans la matière, sur 20. `null` si aucune note. */
  average: number | null;
  /** Moyenne × coefficient, les « points » du bulletin. */
  points: number | null;
  evaluationCount: number;
  /** Repères de la classe dans cette matière. */
  classAverage: number | null;
  classMin: number | null;
  classMax: number | null;
}

export interface StudentBulletin {
  enrollmentId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  subjects: SubjectResult[];
  totalPoints: number;
  totalCoefficients: number;
  /** Moyenne générale sur 20. `null` si aucune note sur la période. */
  average: number | null;
  rank: number | null;
  classSize: number;
  absences: { justified: number; unjustified: number };
}

/** Ramène une note sur 20, quel que soit le barème de l'évaluation. */
const toBase20 = (score: number, maxScore: number): number =>
  maxScore === 20 ? score : (score / maxScore) * 20;

const round2 = (value: number): number => Math.round(value * 100) / 100;

@Injectable()
export class BulletinsService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(Evaluation)
    private readonly evaluationRepository: Repository<Evaluation>,
    @InjectRepository(Grade)
    private readonly gradeRepository: Repository<Grade>,
    @InjectRepository(ClassRoomSubject)
    private readonly programRepository: Repository<ClassRoomSubject>,
    @InjectRepository(GradingPeriod)
    private readonly periodRepository: Repository<GradingPeriod>,
    private readonly absencesService: AbsencesService,
  ) {}

  /**
   * Bulletins de toute une classe pour une période.
   *
   * Le calcul se fait en une passe sur l'ensemble des notes de la classe :
   * les moyennes de classe et le rang exigent de toute façon de connaître
   * tous les élèves, autant les produire ensemble.
   *
   * Règles retenues :
   *  - chaque note est ramenée sur 20 avant d'être moyennée ;
   *  - une absence à une évaluation neutralise la note plutôt que de valoir 0 ;
   *  - une matière sans aucune note ne compte pas dans la moyenne générale,
   *    ni son coefficient — sans quoi un élève serait pénalisé pour une
   *    matière non encore évaluée.
   */
  async getClassBulletins(
    schoolId: string,
    classRoomId: string,
    gradingPeriodId: string,
  ): Promise<{ period: GradingPeriod; bulletins: StudentBulletin[] }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const period = await this.periodRepository.findOne({
      where: { id: gradingPeriodId, schoolId },
      relations: { academicYear: true },
    });
    if (!period) {
      throw new NotFoundException('Période de notation introuvable.');
    }

    const enrollments = await this.enrollmentRepository.find({
      where: {
        schoolId,
        classRoomId,
        academicYearId: period.academicYearId,
        status: In([
          EnrollmentStatus.PENDING_PAYMENT,
          EnrollmentStatus.PARTIALLY_PAID,
          EnrollmentStatus.ENROLLED,
        ]),
      },
      relations: { student: true },
    });

    if (enrollments.length === 0) {
      return { period, bulletins: [] };
    }

    const program = await this.programRepository.find({
      where: { schoolId, classRoomId },
      relations: { subject: true },
    });

    const evaluations = await this.evaluationRepository.find({
      where: { schoolId, classRoomId, gradingPeriodId },
    });

    const grades = evaluations.length
      ? await this.gradeRepository.find({
          where: { evaluationId: In(evaluations.map((e) => e.id)) },
        })
      : [];

    const evaluationById = new Map(evaluations.map((e) => [e.id, e]));

    // notes[enrollmentId][subjectId] = [{ note sur 20, poids }]
    const notes = new Map<string, Map<string, Array<{ value: number; weight: number }>>>();

    for (const grade of grades) {
      if (grade.isAbsent || grade.score === null || grade.score === undefined) {
        continue; // absence : neutralisée, pas comptée comme zéro
      }
      const evaluation = evaluationById.get(grade.evaluationId);
      if (!evaluation) continue;

      const bySubject = notes.get(grade.enrollmentId) ?? new Map();
      const list = bySubject.get(evaluation.subjectId) ?? [];
      list.push({
        value: toBase20(Number(grade.score), evaluation.maxScore),
        weight: Number(evaluation.weight) || 1,
      });
      bySubject.set(evaluation.subjectId, list);
      notes.set(grade.enrollmentId, bySubject);
    }

    /** Moyenne pondérée d'une liste de notes déjà ramenées sur 20. */
    const weightedAverage = (
      list: Array<{ value: number; weight: number }>,
    ): number | null => {
      if (!list || list.length === 0) return null;
      const totalWeight = list.reduce((sum, n) => sum + n.weight, 0);
      if (totalWeight === 0) return null;
      return list.reduce((sum, n) => sum + n.value * n.weight, 0) / totalWeight;
    };

    // Moyennes par élève et par matière
    const subjectAverages = new Map<string, Map<string, number>>();
    for (const enrollment of enrollments) {
      const bySubject = new Map<string, number>();
      for (const entry of program) {
        const list = notes.get(enrollment.id)?.get(entry.subjectId);
        const average = weightedAverage(list ?? []);
        if (average !== null) bySubject.set(entry.subjectId, average);
      }
      subjectAverages.set(enrollment.id, bySubject);
    }

    // Repères de classe par matière
    const classStats = new Map<
      string,
      { average: number | null; min: number | null; max: number | null }
    >();
    for (const entry of program) {
      const values: number[] = [];
      for (const enrollment of enrollments) {
        const v = subjectAverages.get(enrollment.id)?.get(entry.subjectId);
        if (v !== undefined) values.push(v);
      }
      classStats.set(
        entry.subjectId,
        values.length
          ? {
              average: round2(values.reduce((a, b) => a + b, 0) / values.length),
              min: round2(Math.min(...values)),
              max: round2(Math.max(...values)),
            }
          : { average: null, min: null, max: null },
      );
    }

    const absencesByEnrollment = await this.absencesService.countByPeriod(
      schoolId,
      enrollments.map((e) => e.id),
      gradingPeriodId,
    );

    // Bulletins
    const bulletins: StudentBulletin[] = enrollments.map((enrollment) => {
      const bySubject = subjectAverages.get(enrollment.id) ?? new Map();

      let totalPoints = 0;
      let totalCoefficients = 0;

      const subjects: SubjectResult[] = program
        .map((entry) => {
          const average = bySubject.get(entry.subjectId) ?? null;
          const coefficient = Number(entry.coefficient) || 1;
          const points = average !== null ? average * coefficient : null;

          // Une matière non évaluée ne pèse pas dans la moyenne générale
          if (average !== null) {
            totalPoints += points as number;
            totalCoefficients += coefficient;
          }

          const stats = classStats.get(entry.subjectId);
          return {
            subjectId: entry.subjectId,
            name: entry.subject.name,
            shortName: entry.subject.shortName,
            coefficient,
            average: average !== null ? round2(average) : null,
            points: points !== null ? round2(points) : null,
            evaluationCount:
              notes.get(enrollment.id)?.get(entry.subjectId)?.length ?? 0,
            classAverage: stats?.average ?? null,
            classMin: stats?.min ?? null,
            classMax: stats?.max ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        firstName: enrollment.student?.firstName ?? '',
        lastName: enrollment.student?.lastName ?? '',
        subjects,
        totalPoints: round2(totalPoints),
        totalCoefficients: round2(totalCoefficients),
        average:
          totalCoefficients > 0 ? round2(totalPoints / totalCoefficients) : null,
        rank: null,
        classSize: enrollments.length,
        absences: absencesByEnrollment.get(enrollment.id) ?? {
          justified: 0,
          unjustified: 0,
        },
      };
    });

    // Rang : les élèves sans aucune note ne sont pas classés. Ex aequo
    // partagent le même rang.
    const ranked = bulletins
      .filter((b) => b.average !== null)
      .sort((a, b) => (b.average as number) - (a.average as number));

    ranked.forEach((bulletin, index) => {
      const previous = ranked[index - 1];
      bulletin.rank =
        previous && previous.average === bulletin.average
          ? (previous.rank as number)
          : index + 1;
    });

    bulletins.sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );

    return { period, bulletins };
  }

  /** Bulletin d'un seul élève, extrait du calcul de sa classe. */
  async getStudentBulletin(
    schoolId: string,
    enrollmentId: string,
    gradingPeriodId: string,
  ): Promise<{ period: GradingPeriod; bulletin: StudentBulletin }> {
    const enrollment = await this.enrollmentRepository.findOne({
      where: { id: enrollmentId, schoolId },
    });
    if (!enrollment) {
      throw new NotFoundException(`Inscription introuvable (${enrollmentId})`);
    }

    const { period, bulletins } = await this.getClassBulletins(
      schoolId,
      enrollment.classRoomId,
      gradingPeriodId,
    );

    const bulletin = bulletins.find((b) => b.enrollmentId === enrollmentId);
    if (!bulletin) {
      throw new NotFoundException(
        "Cet élève n'a pas de bulletin sur cette période.",
      );
    }

    return { period, bulletin };
  }
}
