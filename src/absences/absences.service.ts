import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
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
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';

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
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Un enseignant ne travaille que sur les classes où il intervient.
   *
   * La direction n'est jamais soumise à ce contrôle. Le secrétariat en est
   * dispensé en lecture — il centralise le suivi de l'assiduité — mais ne
   * constate pas l'appel lui-même : la saisie lui est fermée en amont, dans le
   * contrôleur.
   */
  private async assertCanAccessClass(
    user: AuthUser,
    classRoomId: string,
    academicYearId: string,
    mode: 'read' | 'write' = 'write',
  ): Promise<void> {
    const exempt =
      mode === 'read'
        ? [Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY]
        : [Role.SUPER_ADMIN, Role.DIRECTOR];
    if (user.roles.some((r) => exempt.includes(r))) return;

    const assignments = await this.teachingService.findAll(user.schoolId, {
      teacherId: user.id,
      classRoomId,
      academicYearId,
    });

    if (assignments.length === 0) {
      throw new ForbiddenException("Vous n'intervenez pas dans cette classe.");
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
  ): Promise<GradingPeriod | null> {
    const periods = await this.periodRepository.find({
      where: { schoolId, academicYearId },
      order: { sequence: 'ASC' },
    });

    return (
      periods.find(
        (p) =>
          p.startDate &&
          p.endDate &&
          date >= new Date(p.startDate) &&
          date <= new Date(p.endDate),
      ) ?? null
    );
  }

  /** Jour courant au format `AAAA-MM-JJ`, dans le fuseau du serveur. */
  private today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }

  /**
   * Contrôle la date d'un appel et renvoie la période de notation concernée.
   *
   * Trois refus, dans cet ordre :
   *  - une date à venir : on ne constate pas une absence qui n'a pas eu lieu ;
   *  - une date hors année scolaire : aucune période ne la couvre, l'absence
   *    ne serait comptée sur aucun bulletin et resterait invisible ;
   *  - une période clôturée : les bulletins sont édités, leur cumul d'absences
   *    ne peut plus être contredit après coup.
   */
  private async resolveOpenPeriod(
    schoolId: string,
    academicYearId: string,
    date: string,
  ): Promise<GradingPeriod> {
    if (date > this.today()) {
      throw new BadRequestException(
        "L'appel ne peut pas être fait pour une date à venir.",
      );
    }

    const period = await this.resolvePeriod(
      schoolId,
      academicYearId,
      new Date(date),
    );

    if (!period) {
      throw new BadRequestException(
        `Le ${date} ne tombe dans aucune période de notation de cette année scolaire : l'appel n'y serait rattaché à aucun bulletin.`,
      );
    }

    if (period.isClosed) {
      throw new ConflictException(
        `La période ${period.label} est clôturée : l'appel n'y est plus modifiable.`,
      );
    }

    return period;
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

    const period = await this.resolveOpenPeriod(
      schoolId,
      dto.academicYearId,
      dto.date,
    );
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

    const gradingPeriodId = period.id;

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

    /**
     * Effacements et enregistrements dans une seule transaction.
     *
     * Séparément, une panne entre les deux laissait l'appel à moitié pris :
     * des élèves repassés présents mais toujours marqués absents, ou
     * l'inverse. Un appel vaut pour la classe entière ou pour personne — c'est
     * un relevé, pas une suite d'écritures indépendantes.
     */
    if (toRemove.length > 0 || toSave.length > 0) {
      await this.dataSource.transaction(async (manager) => {
        if (toRemove.length > 0) await manager.remove(toRemove);
        if (toSave.length > 0) await manager.save(toSave);
      });
    }

    /**
     * Une absence non justifiée a des conséquences — au bulletin, et parfois
     * sur la bourse de l'élève. La famille qui la conteste doit pouvoir savoir
     * qui l'a saisie, et quand.
     */
    if (toRemove.length > 0 || toSave.length > 0) {
      void this.auditService.record(
        {
          action: AuditAction.ABSENCES_RECORDED,
          entityType: 'absences',
          entityId: dto.classRoomId,
          schoolId,
          summary:
            `Appel du ${dto.date} : ${toSave.length} absence(s) enregistrée(s)` +
            (toRemove.length > 0 ? `, ${toRemove.length} levée(s)` : ''),
        },
        user,
      );
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
    await this.assertCanAccessClass(user, classRoomId, academicYearId, 'read');

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
    const result = new Map<
      string,
      { justified: number; unjustified: number }
    >();
    if (enrollmentIds.length === 0) return result;

    const rows = await this.absenceRepository
      .createQueryBuilder('absence')
      .select('absence.enrollmentId', 'enrollmentId')
      .addSelect('absence.isJustified', 'isJustified')
      .addSelect('COUNT(*)', 'count')
      .where('absence.schoolId = :schoolId', { schoolId })
      .andWhere('absence.enrollmentId IN (:...enrollmentIds)', {
        enrollmentIds,
      })
      .andWhere('absence.gradingPeriodId = :gradingPeriodId', {
        gradingPeriodId,
      })
      .groupBy('absence.enrollmentId')
      .addGroupBy('absence.isJustified')
      .getRawMany<{
        enrollmentId: string;
        isJustified: boolean;
        count: string;
      }>();

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
