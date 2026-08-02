import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { TeachingService } from '../teaching/teaching.service';
import { RecordAbsencesDto, UpdateAbsenceDto } from './dto/absence.dto';
import { Absence, HalfDay } from './entities/absence.entity';

@Injectable()
export class AbsencesService {
  constructor(
    @InjectRepository(Absence)
    private readonly absenceRepository: Repository<Absence>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(GradingPeriod)
    private readonly periodRepository: Repository<GradingPeriod>,
    private readonly teachingService: TeachingService,
  ) {}

  /**
   * Un enseignant ne fait l'appel que dans les classes où il intervient.
   * Le secrétariat et la direction ne sont pas soumis à ce contrôle : ce sont
   * eux qui centralisent l'assiduité.
   */
  private async assertCanAccessClass(
    user: AuthUser,
    classRoomId: string,
    academicYearId: string,
  ): Promise<void> {
    const isStaff = user.roles.some((r) =>
      [Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY].includes(r),
    );
    if (isStaff) return;

    const assignments = await this.teachingService.findAll(user.schoolId, {
      teacherId: user.id,
      classRoomId,
      academicYearId,
    });

    if (assignments.length === 0) {
      throw new ForbiddenException(
        "Vous n'intervenez pas dans cette classe.",
      );
    }
  }

  /**
   * Détermine la période de notation qui contient une date, afin que le cumul
   * du bulletin reste stable si les dates de période sont ajustées ensuite.
   */
  private async resolvePeriod(
    schoolId: string,
    academicYearId: string,
    date: Date,
  ): Promise<string | null> {
    const periods = await this.periodRepository.find({
      where: { schoolId, academicYearId },
      order: { sequence: 'ASC' },
    });

    const match = periods.find(
      (p) =>
        p.startDate &&
        p.endDate &&
        date >= new Date(p.startDate) &&
        date <= new Date(p.endDate),
    );
    return match?.id ?? null;
  }

  /**
   * Appel d'une classe pour une date : enregistre les absents fournis et
   * efface les absences de cette date qui ne sont plus déclarées — un élève
   * retiré de la liste est de nouveau considéré présent.
   */
  async record(
    dto: RecordAbsencesDto,
    schoolId: string,
    user: AuthUser,
  ): Promise<{ recorded: number; cleared: number }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    await this.assertCanAccessClass(user, dto.classRoomId, dto.academicYearId);
    const recordedByUserId = user.id;

    const date = new Date(dto.date);

    const classEnrollments = await this.enrollmentRepository.find({
      where: {
        schoolId,
        classRoomId: dto.classRoomId,
        academicYearId: dto.academicYearId,
        status: In([
          EnrollmentStatus.PENDING_PAYMENT,
          EnrollmentStatus.PARTIALLY_PAID,
          EnrollmentStatus.ENROLLED,
        ]),
      },
      select: { id: true },
    });
    const classEnrollmentIds = classEnrollments.map((e) => e.id);

    const gradingPeriodId = await this.resolvePeriod(
      schoolId,
      dto.academicYearId,
      date,
    );

    // Absences déjà enregistrées pour cette classe à cette date
    const existing = classEnrollmentIds.length
      ? await this.absenceRepository.find({
          where: { schoolId, date, enrollmentId: In(classEnrollmentIds) },
        })
      : [];

    const declared = dto.absences.filter((a) =>
      classEnrollmentIds.includes(a.enrollmentId),
    );
    const declaredKeys = new Set(
      declared.map((a) => `${a.enrollmentId}|${a.halfDay}`),
    );

    // Ce qui n'est plus déclaré est effacé : l'élève est repassé présent
    const toRemove = existing.filter(
      (a) => !declaredKeys.has(`${a.enrollmentId}|${a.halfDay}`),
    );
    if (toRemove.length > 0) {
      await this.absenceRepository.remove(toRemove);
    }

    const byKey = new Map(
      existing.map((a) => [`${a.enrollmentId}|${a.halfDay}`, a]),
    );

    const toSave = declared.map((entry) => {
      const key = `${entry.enrollmentId}|${entry.halfDay}`;
      const payload = {
        schoolId,
        enrollmentId: entry.enrollmentId,
        gradingPeriodId,
        date,
        halfDay: entry.halfDay,
        isJustified: entry.isJustified ?? false,
        reason: entry.reason?.trim() || null,
        recordedByUserId,
      };
      const current = byKey.get(key);
      return current
        ? this.absenceRepository.merge(current, payload)
        : this.absenceRepository.create(payload);
    });

    if (toSave.length > 0) {
      await this.absenceRepository.save(toSave);
    }

    return { recorded: toSave.length, cleared: toRemove.length };
  }

  /**
   * Feuille d'appel : les élèves de la classe et leur statut aux deux
   * demi-journées de la date demandée.
   *
   * Endpoint dédié plutôt que la liste des dossiers : celle-ci expose le solde
   * et les montants dus des familles, que l'enseignant qui fait l'appel n'a
   * pas à connaître.
   */
  async getRollCall(
    schoolId: string,
    classRoomId: string,
    academicYearId: string,
    date: string,
    user: AuthUser,
  ) {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    await this.assertCanAccessClass(user, classRoomId, academicYearId);

    const enrollments = await this.enrollmentRepository.find({
      where: {
        schoolId,
        classRoomId,
        academicYearId,
        status: In([
          EnrollmentStatus.PENDING_PAYMENT,
          EnrollmentStatus.PARTIALLY_PAID,
          EnrollmentStatus.ENROLLED,
        ]),
      },
      relations: { student: true },
    });

    if (enrollments.length === 0) return { date, students: [] };

    const absences = await this.absenceRepository.find({
      where: {
        schoolId,
        date: new Date(date),
        enrollmentId: In(enrollments.map((e) => e.id)),
      },
    });

    const byKey = new Map(
      absences.map((a) => [`${a.enrollmentId}|${a.halfDay}`, a]),
    );

    const students = enrollments
      .map((enrollment) => {
        const morning = byKey.get(`${enrollment.id}|${HalfDay.MORNING}`);
        const afternoon = byKey.get(`${enrollment.id}|${HalfDay.AFTERNOON}`);
        return {
          enrollmentId: enrollment.id,
          studentId: enrollment.studentId,
          firstName: enrollment.student?.firstName ?? '',
          lastName: enrollment.student?.lastName ?? '',
          morning: morning
            ? {
                id: morning.id,
                isJustified: morning.isJustified,
                reason: morning.reason,
              }
            : null,
          afternoon: afternoon
            ? {
                id: afternoon.id,
                isJustified: afternoon.isJustified,
                reason: afternoon.reason,
              }
            : null,
        };
      })
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      );

    return { date, students };
  }

  /** Absences d'une classe à une date donnée (relecture de l'appel). */
  async findByClassRoomAndDate(
    schoolId: string,
    classRoomId: string,
    academicYearId: string,
    date: string,
  ): Promise<Absence[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const enrollments = await this.enrollmentRepository.find({
      where: { schoolId, classRoomId, academicYearId },
      select: { id: true },
    });
    if (enrollments.length === 0) return [];

    return await this.absenceRepository.find({
      where: {
        schoolId,
        date: new Date(date),
        enrollmentId: In(enrollments.map((e) => e.id)),
      },
      relations: { enrollment: { student: true } },
    });
  }

  /** Historique d'un élève sur son dossier d'inscription. */
  async findByEnrollment(
    enrollmentId: string,
    schoolId: string,
  ): Promise<Absence[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    return await this.absenceRepository.find({
      where: { schoolId, enrollmentId },
      relations: { gradingPeriod: true },
      order: { date: 'DESC' },
    });
  }

  /**
   * Cumul par inscription sur une période, en demi-journées.
   * Utilisé par le bulletin.
   */
  async countByPeriod(
    schoolId: string,
    enrollmentIds: string[],
    gradingPeriodId: string,
  ): Promise<Map<string, { justified: number; unjustified: number }>> {
    const result = new Map<string, { justified: number; unjustified: number }>();
    if (enrollmentIds.length === 0) return result;

    const rows = await this.absenceRepository
      .createQueryBuilder('absence')
      .select('absence.enrollmentId', 'enrollmentId')
      .addSelect('absence.isJustified', 'isJustified')
      .addSelect('COUNT(*)', 'count')
      .where('absence.schoolId = :schoolId', { schoolId })
      .andWhere('absence.enrollmentId IN (:...enrollmentIds)', { enrollmentIds })
      .andWhere('absence.gradingPeriodId = :gradingPeriodId', { gradingPeriodId })
      .groupBy('absence.enrollmentId')
      .addGroupBy('absence.isJustified')
      .getRawMany<{ enrollmentId: string; isJustified: boolean; count: string }>();

    for (const row of rows) {
      const entry = result.get(row.enrollmentId) ?? {
        justified: 0,
        unjustified: 0,
      };
      if (row.isJustified) entry.justified = Number(row.count);
      else entry.unjustified = Number(row.count);
      result.set(row.enrollmentId, entry);
    }

    return result;
  }

  async update(
    id: string,
    dto: UpdateAbsenceDto,
    schoolId: string,
  ): Promise<Absence> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const absence = await this.absenceRepository.findOne({
      where: { id, schoolId },
    });
    if (!absence) {
      throw new NotFoundException(`Absence introuvable (${id})`);
    }
    if (dto.isJustified !== undefined) absence.isJustified = dto.isJustified;
    if (dto.reason !== undefined) absence.reason = dto.reason?.trim() || null;
    return await this.absenceRepository.save(absence);
  }

  async remove(id: string, schoolId: string): Promise<{ message: string }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const absence = await this.absenceRepository.findOne({
      where: { id, schoolId },
    });
    if (!absence) {
      throw new NotFoundException(`Absence introuvable (${id})`);
    }
    await this.absenceRepository.remove(absence);
    return { message: 'Absence supprimée.' };
  }
}
