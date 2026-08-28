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
import {
  DayOfWeek,
  ScheduleEntry,
} from '../schedule/entities/schedule-entry.entity';
import { RecordAbsencesDto, UpdateAbsenceDto } from './dto/absence.dto';
import { Absence, AbsenceStatus } from './entities/absence.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';

/** Libellés des jours, pour des messages de refus compréhensibles. */
const DAY_LABELS: Record<DayOfWeek, string> = {
  [DayOfWeek.MONDAY]: 'lundi',
  [DayOfWeek.TUESDAY]: 'mardi',
  [DayOfWeek.WEDNESDAY]: 'mercredi',
  [DayOfWeek.THURSDAY]: 'jeudi',
  [DayOfWeek.FRIDAY]: 'vendredi',
};

@Injectable()
export class AbsencesService {
  constructor(
    @InjectRepository(Absence)
    private readonly absenceRepository: Repository<Absence>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(GradingPeriod)
    private readonly periodRepository: Repository<GradingPeriod>,
    @InjectRepository(ScheduleEntry)
    private readonly scheduleRepository: Repository<ScheduleEntry>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Résolution de la séance — le cœur du contrôle
  // ------------------------------------------------------------------

  /**
   * Charge la séance appelée et vérifie qu'elle peut l'être à cette date.
   *
   * Trois contrôles, dans cet ordre :
   *
   *  1. **La séance appartient à l'école.** Comme partout ailleurs.
   *  2. **L'enseignant assure ce cours.** Un professeur ne fait l'appel que
   *     dans ses propres créneaux ; la direction en est dispensée, c'est elle
   *     qui corrige quand un enseignant n'a pas pu saisir.
   *  3. **La date tombe le bon jour de la semaine.** Un cours du lundi ne peut
   *     être appelé que pour un lundi. La saisie différée reste possible — un
   *     professeur peut relever le mardi l'appel du lundi — mais elle porte
   *     alors sur la séance du lundi, pas sur celle du jour où il saisit.
   *
   * Il n'y a volontairement **aucune contrainte sur l'heure de saisie** :
   * exiger que l'appel soit fait entre 7h30 et 9h30 rendrait le relevé
   * impossible dès qu'un réseau tombe, sans rien garantir de plus.
   */
  private async resolveSession(
    scheduleEntryId: string,
    date: string,
    schoolId: string,
    user: AuthUser,
  ): Promise<ScheduleEntry> {
    const entry = await this.scheduleRepository.findOne({
      where: { id: scheduleEntryId, schoolId },
      relations: {
        timeSlot: true,
        classRoom: true,
        teachingAssignment: { subject: true },
      },
    });

    if (!entry) {
      throw new NotFoundException(
        "Cette séance n'existe pas dans l'emploi du temps de l'établissement.",
      );
    }

    const isStaffAbove = user.roles.some((r) =>
      [Role.SUPER_ADMIN, Role.DIRECTOR].includes(r),
    );

    if (!isStaffAbove && entry.teacherId !== user.id) {
      throw new ForbiddenException(
        "Vous n'assurez pas ce cours : l'appel revient à l'enseignant du créneau.",
      );
    }

    const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
    if (dayOfWeek !== entry.dayOfWeek) {
      const expected = DAY_LABELS[entry.dayOfWeek] ?? 'un autre jour';
      throw new BadRequestException(
        `Ce cours a lieu le ${expected} : le ${date} ne correspond pas. ` +
          "Choisissez une date qui tombe un " + expected + '.',
      );
    }

    return entry;
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

  // ------------------------------------------------------------------
  // Appel
  // ------------------------------------------------------------------

  /**
   * Séances qu'un enseignant peut appeler à une date donnée.
   *
   * Alimente son écran : il choisit une date, on lui propose ses cours de ce
   * jour-là. Sans cette liste, il devrait deviner quel créneau viser.
   */
  async getMySessions(schoolId: string, date: string, user: AuthUser) {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const dayOfWeek = new Date(`${date}T00:00:00`).getDay();

    const isStaffAbove = user.roles.some((r) =>
      [Role.SUPER_ADMIN, Role.DIRECTOR].includes(r),
    );

    const entries = await this.scheduleRepository.find({
      where: {
        schoolId,
        dayOfWeek,
        ...(isStaffAbove ? {} : { teacherId: user.id }),
      },
      relations: {
        timeSlot: true,
        classRoom: true,
        teachingAssignment: { subject: true },
      },
    });

    return entries
      .filter((e) => !e.timeSlot?.isBreak)
      .map((e) => ({
        scheduleEntryId: e.id,
        classRoomId: e.classRoomId,
        classRoomName: e.classRoom?.name ?? '',
        subjectId: e.teachingAssignment?.subjectId ?? '',
        subjectName: e.teachingAssignment?.subject?.name ?? '',
        timeSlotLabel: e.timeSlot?.label ?? '',
        startTime: e.timeSlot?.startTime ?? '',
        endTime: e.timeSlot?.endTime ?? '',
        sequence: e.timeSlot?.sequence ?? 0,
      }))
      .sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Feuille d'appel d'une séance : les élèves de la classe et leur statut.
   *
   * Endpoint dédié plutôt que la liste des dossiers : celle-ci expose le solde
   * et les montants dus des familles, que l'enseignant n'a pas à connaître.
   */
  async getRollCall(
    schoolId: string,
    scheduleEntryId: string,
    date: string,
    user: AuthUser,
  ) {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const session = await this.resolveSession(
      scheduleEntryId,
      date,
      schoolId,
      user,
    );

    const enrollments = await this.enrollmentRepository.find({
      where: {
        schoolId,
        classRoomId: session.classRoomId,
        academicYearId: session.academicYearId,
        status: In([
          EnrollmentStatus.PENDING_PAYMENT,
          EnrollmentStatus.PARTIALLY_PAID,
          EnrollmentStatus.ENROLLED,
        ]),
      },
      relations: { student: true },
    });

    const session_info = {
      scheduleEntryId: session.id,
      classRoomName: session.classRoom?.name ?? '',
      subjectName: session.teachingAssignment?.subject?.name ?? '',
      timeSlotLabel: session.timeSlot?.label ?? '',
      startTime: session.timeSlot?.startTime ?? '',
      endTime: session.timeSlot?.endTime ?? '',
    };

    if (enrollments.length === 0) {
      return { date, session: session_info, students: [] };
    }

    const marks = await this.absenceRepository.find({
      where: {
        schoolId,
        date: new Date(date),
        timeSlotId: session.timeSlotId,
        enrollmentId: In(enrollments.map((e) => e.id)),
      },
    });
    const byEnrollment = new Map(marks.map((a) => [a.enrollmentId, a]));

    const students = enrollments
      .map((enrollment) => {
        const mark = byEnrollment.get(enrollment.id);
        return {
          enrollmentId: enrollment.id,
          studentId: enrollment.studentId,
          firstName: enrollment.student?.firstName ?? '',
          lastName: enrollment.student?.lastName ?? '',
          // `null` = présent : l'absence de ligne est l'état normal.
          mark: mark
            ? {
                id: mark.id,
                status: mark.status,
                isJustified: mark.isJustified,
                reason: mark.reason,
              }
            : null,
        };
      })
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      );

    return { date, session: session_info, students };
  }

  /**
   * Appel d'une séance : enregistre les écarts fournis et efface ceux de
   * cette séance qui ne sont plus déclarés — un élève retiré de la liste est
   * de nouveau considéré présent.
   */
  async record(
    dto: RecordAbsencesDto,
    schoolId: string,
    user: AuthUser,
  ): Promise<{ recorded: number; cleared: number }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const session = await this.resolveSession(
      dto.scheduleEntryId,
      dto.date,
      schoolId,
      user,
    );

    const period = await this.resolveOpenPeriod(
      schoolId,
      session.academicYearId,
      dto.date,
    );
    const date = new Date(dto.date);

    const classEnrollments = await this.enrollmentRepository.find({
      where: {
        schoolId,
        classRoomId: session.classRoomId,
        academicYearId: session.academicYearId,
        status: In([
          EnrollmentStatus.PENDING_PAYMENT,
          EnrollmentStatus.PARTIALLY_PAID,
          EnrollmentStatus.ENROLLED,
        ]),
      },
      select: { id: true },
    });
    const classEnrollmentIds = classEnrollments.map((e) => e.id);

    const existing = classEnrollmentIds.length
      ? await this.absenceRepository.find({
          where: {
            schoolId,
            date,
            timeSlotId: session.timeSlotId,
            enrollmentId: In(classEnrollmentIds),
          },
        })
      : [];

    // Les entrées visant un élève d'une autre classe sont écartées sans faire
    // échouer l'appel : elles ne peuvent venir que d'un écran désynchronisé.
    const declared = dto.entries.filter((e) =>
      classEnrollmentIds.includes(e.enrollmentId),
    );
    const declaredIds = new Set(declared.map((e) => e.enrollmentId));

    const toRemove = existing.filter((a) => !declaredIds.has(a.enrollmentId));
    const byEnrollment = new Map(existing.map((a) => [a.enrollmentId, a]));

    const toSave = declared.map((entry) => {
      const payload = {
        schoolId,
        enrollmentId: entry.enrollmentId,
        scheduleEntryId: session.id,
        subjectId: session.teachingAssignment?.subjectId as string,
        timeSlotId: session.timeSlotId,
        gradingPeriodId: period.id,
        date,
        status: entry.status,
        isJustified: entry.isJustified ?? false,
        reason: entry.reason?.trim() || null,
        recordedByUserId: user.id,
      };
      const current = byEnrollment.get(entry.enrollmentId);
      return current
        ? this.absenceRepository.merge(current, payload)
        : this.absenceRepository.create(payload);
    });

    /**
     * Effacements et enregistrements dans une seule transaction.
     *
     * Séparément, une panne entre les deux laissait l'appel à moitié pris :
     * des élèves repassés présents mais toujours marqués absents, ou
     * l'inverse. Un appel vaut pour la séance entière ou pour rien.
     */
    if (toRemove.length > 0 || toSave.length > 0) {
      await this.dataSource.transaction(async (manager) => {
        if (toRemove.length > 0) await manager.remove(toRemove);
        if (toSave.length > 0) await manager.save(toSave);
      });

      /**
       * Une absence non justifiée a des conséquences — au bulletin, et parfois
       * sur la bourse de l'élève. La famille qui la conteste doit pouvoir
       * savoir quel cours, qui l'a saisie, et quand.
       */
      void this.auditService.record(
        {
          action: AuditAction.ABSENCES_RECORDED,
          entityType: 'absences',
          entityId: session.id,
          schoolId,
          summary:
            `Appel du ${dto.date}, ${session.teachingAssignment?.subject?.name ?? 'cours'} ` +
            `en ${session.classRoom?.name ?? ''} (${session.timeSlot?.label ?? ''}) : ` +
            `${toSave.length} écart(s) enregistré(s)` +
            (toRemove.length > 0 ? `, ${toRemove.length} levé(s)` : ''),
        },
        user,
      );
    }

    return { recorded: toSave.length, cleared: toRemove.length };
  }

  // ------------------------------------------------------------------
  // Lectures
  // ------------------------------------------------------------------

  /** Historique d'un élève sur son dossier d'inscription. */
  async findByEnrollment(
    enrollmentId: string,
    schoolId: string,
  ): Promise<Absence[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    return await this.absenceRepository.find({
      where: { schoolId, enrollmentId },
      relations: { gradingPeriod: true, subject: true, timeSlot: true },
      order: { date: 'DESC' },
    });
  }

  /**
   * Cumul par inscription sur une période, en **séances manquées**.
   *
   * L'unité a changé avec le modèle : on comptait des demi-journées, on compte
   * désormais des séances de cours. Les retards ne sont pas comptés comme des
   * absences — l'élève était là.
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
      .andWhere('absence.status = :status', { status: AbsenceStatus.ABSENT })
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

  // ------------------------------------------------------------------
  // Espace direction
  // ------------------------------------------------------------------

  /**
   * Suivi de l'assiduité par matière et par classe, pour la direction.
   *
   * Répond à la question que l'écran d'appel ne peut pas poser : « qui manque,
   * dans quelle matière, et depuis combien de temps ». Le cumul par élève est
   * calculé en base plutôt qu'en mémoire — une classe de trente élèves sur un
   * trimestre représente des centaines de lignes.
   */
  async getOverview(
    schoolId: string,
    filters: {
      academicYearId?: string;
      gradingPeriodId?: string;
      classRoomId?: string;
      subjectId?: string;
    },
  ) {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const query = this.absenceRepository
      .createQueryBuilder('absence')
      .innerJoin('absence.enrollment', 'enrollment')
      .innerJoin('enrollment.student', 'student')
      .innerJoin('absence.subject', 'subject')
      .innerJoin('enrollment.classRoom', 'classRoom')
      .select('enrollment.id', 'enrollmentId')
      .addSelect('student.lastName', 'lastName')
      .addSelect('student.firstName', 'firstName')
      .addSelect('classRoom.id', 'classRoomId')
      .addSelect('classRoom.name', 'classRoomName')
      .addSelect('subject.id', 'subjectId')
      .addSelect('subject.name', 'subjectName')
      .addSelect(
        `COUNT(*) FILTER (WHERE absence.status = '${AbsenceStatus.ABSENT}' AND absence.isJustified = false)`,
        'unjustified',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE absence.status = '${AbsenceStatus.ABSENT}' AND absence.isJustified = true)`,
        'justified',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE absence.status = '${AbsenceStatus.LATE}')`,
        'late',
      )
      .where('absence.schoolId = :schoolId', { schoolId })
      .groupBy('enrollment.id')
      .addGroupBy('student.lastName')
      .addGroupBy('student.firstName')
      .addGroupBy('classRoom.id')
      .addGroupBy('classRoom.name')
      .addGroupBy('subject.id')
      .addGroupBy('subject.name')
      .orderBy('"unjustified"', 'DESC')
      .addOrderBy('student.lastName', 'ASC');

    if (filters.academicYearId) {
      query.andWhere('enrollment.academicYearId = :academicYearId', {
        academicYearId: filters.academicYearId,
      });
    }
    if (filters.gradingPeriodId) {
      query.andWhere('absence.gradingPeriodId = :gradingPeriodId', {
        gradingPeriodId: filters.gradingPeriodId,
      });
    }
    if (filters.classRoomId) {
      query.andWhere('enrollment.classRoomId = :classRoomId', {
        classRoomId: filters.classRoomId,
      });
    }
    if (filters.subjectId) {
      query.andWhere('absence.subjectId = :subjectId', {
        subjectId: filters.subjectId,
      });
    }

    const rows = await query.getRawMany<{
      enrollmentId: string;
      lastName: string;
      firstName: string;
      classRoomId: string;
      classRoomName: string;
      subjectId: string;
      subjectName: string;
      unjustified: string;
      justified: string;
      late: string;
    }>();

    return rows.map((r) => ({
      enrollmentId: r.enrollmentId,
      lastName: r.lastName,
      firstName: r.firstName,
      classRoomId: r.classRoomId,
      classRoomName: r.classRoomName,
      subjectId: r.subjectId,
      subjectName: r.subjectName,
      unjustified: Number(r.unjustified),
      justified: Number(r.justified),
      late: Number(r.late),
    }));
  }

  /**
   * Élèves dépassant un seuil d'absences non justifiées sur la période.
   *
   * Le seuil est un paramètre et non une constante : ce qui alerte dans une
   * classe de terminale n'alerte pas en sixième, et l'établissement seul sait
   * où il place la limite.
   */
  async getAtRisk(
    schoolId: string,
    threshold: number,
    filters: { academicYearId?: string; gradingPeriodId?: string },
  ) {
    const rows = await this.getOverview(schoolId, filters);

    const byEnrollment = new Map<
      string,
      {
        enrollmentId: string;
        lastName: string;
        firstName: string;
        classRoomName: string;
        unjustified: number;
        subjects: string[];
      }
    >();

    for (const row of rows) {
      const entry = byEnrollment.get(row.enrollmentId) ?? {
        enrollmentId: row.enrollmentId,
        lastName: row.lastName,
        firstName: row.firstName,
        classRoomName: row.classRoomName,
        unjustified: 0,
        subjects: [],
      };
      entry.unjustified += row.unjustified;
      if (row.unjustified > 0) entry.subjects.push(row.subjectName);
      byEnrollment.set(row.enrollmentId, entry);
    }

    return [...byEnrollment.values()]
      .filter((e) => e.unjustified >= threshold)
      .sort((a, b) => b.unjustified - a.unjustified);
  }

  // ------------------------------------------------------------------
  // Correction
  // ------------------------------------------------------------------

  async update(
    id: string,
    dto: UpdateAbsenceDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<Absence> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const absence = await this.absenceRepository.findOne({
      where: { id, schoolId },
      relations: { subject: true },
    });
    if (!absence) {
      throw new NotFoundException(`Absence introuvable (${id})`);
    }

    if (dto.status !== undefined) absence.status = dto.status;
    if (dto.isJustified !== undefined) absence.isJustified = dto.isJustified;
    if (dto.reason !== undefined) absence.reason = dto.reason?.trim() || null;

    const saved = await this.absenceRepository.save(absence);

    void this.auditService.record(
      {
        action: AuditAction.ABSENCES_RECORDED,
        entityType: 'absences',
        entityId: saved.id,
        schoolId,
        summary: `Assiduité corrigée en ${saved.subject?.name ?? 'cours'} : ${saved.status}${saved.isJustified ? ', justifiée' : ''}`,
      },
      actor,
    );

    return saved;
  }

  async remove(
    id: string,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<{ message: string }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const absence = await this.absenceRepository.findOne({
      where: { id, schoolId },
      relations: { subject: true },
    });
    if (!absence) {
      throw new NotFoundException(`Absence introuvable (${id})`);
    }

    const label = absence.subject?.name ?? 'cours';
    await this.absenceRepository.remove(absence);

    void this.auditService.record(
      {
        action: AuditAction.ABSENCES_RECORDED,
        entityType: 'absences',
        entityId: id,
        schoolId,
        summary: `Absence supprimée en ${label} — l'élève est repassé présent`,
      },
      actor,
    );

    return { message: 'Absence supprimée.' };
  }
}
