import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { TeachingAssignment } from '../teaching/entities/teaching-assignment.entity';
import {
  CreateScheduleEntryDto,
  CreateTimeSlotDto,
  MoveScheduleEntryDto,
  UpdateTimeSlotDto,
} from './dto/schedule.dto';
import { DayOfWeek, ScheduleEntry } from './entities/schedule-entry.entity';
import { TimeSlot } from './entities/time-slot.entity';

/** Une séance telle qu'affichée dans la grille. */
export interface ScheduleCell {
  id: string;
  dayOfWeek: DayOfWeek;
  timeSlotId: string;
  subject: { id: string; name: string; shortName: string | null };
  teacher: { id: string; email: string };
  classRoom: { id: string; name: string };
  teachingAssignmentId: string;
}

/** Emploi du temps complet : la grille horaire et ce qui la remplit. */
export interface ScheduleGrid {
  academicYear: { id: string; label: string };
  slots: TimeSlot[];
  entries: ScheduleCell[];
}

/** Une affectation, avec le nombre de séances déjà posées. */
export interface AssignmentUsage {
  id: string;
  subject: { id: string; name: string; shortName: string | null };
  teacher: { id: string; email: string };
  classRoom: { id: string; name: string };
  scheduledCount: number;
}

/** Code PostgreSQL d'une violation de contrainte d'unicité. */
const UNIQUE_VIOLATION = '23505';

/**
 * Ramène une heure au format `HH:MM:SS`.
 *
 * La saisie envoie `HH:MM`, PostgreSQL renvoie `HH:MM:SS` : comparer les deux
 * formes comme des chaînes fait passer `08:25` pour antérieur à `08:25:00`, et
 * un créneau qui commence exactement quand le précédent finit serait rejeté
 * comme chevauchant. On normalise donc avant toute comparaison ou écriture.
 */
const toFullTime = (time: string): string =>
  time.length === 5 ? `${time}:00` : time;

/**
 * Emploi du temps hebdomadaire.
 *
 * Deux objets : la **grille horaire** de l'établissement, définie une fois, et
 * les **séances** qui viennent s'y poser, année par année.
 *
 * Une séance ne désigne pas un enseignant et une matière mais une affectation
 * (`TeachingAssignment`), qui porte déjà le triplet validé. Programmer un
 * enseignant sur une matière qui n'est pas la sienne devient impossible par
 * construction, sans contrôle supplémentaire.
 */
@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(TimeSlot)
    private readonly slotRepository: Repository<TimeSlot>,
    @InjectRepository(ScheduleEntry)
    private readonly entryRepository: Repository<ScheduleEntry>,
    @InjectRepository(TeachingAssignment)
    private readonly assignmentRepository: Repository<TeachingAssignment>,
    @InjectRepository(AcademicYear)
    private readonly yearRepository: Repository<AcademicYear>,
  ) {}

  /* ─── Grille horaire ─────────────────────────────────────────────────── */

  async findSlots(schoolId: string): Promise<TimeSlot[]> {
    return await this.slotRepository.find({
      where: { schoolId },
      order: { sequence: 'ASC' },
    });
  }

  /**
   * Vérifie qu'un créneau tient debout et ne recouvre aucun autre.
   *
   * Deux créneaux qui se chevauchent rendraient la grille incohérente : une
   * classe pourrait être en cours à deux endroits sans qu'aucune contrainte
   * d'unicité ne s'en aperçoive, puisqu'il s'agirait de deux créneaux
   * distincts.
   */
  private async assertSlotIsSound(
    schoolId: string,
    slot: { startTime: string; endTime: string },
    excludeId?: string,
  ): Promise<void> {
    const start = toFullTime(slot.startTime);
    const end = toFullTime(slot.endTime);

    if (start >= end) {
      throw new BadRequestException(
        "L'heure de fin doit être postérieure à l'heure de début.",
      );
    }

    const others = await this.slotRepository.find({
      where: excludeId
        ? { schoolId, id: Not(excludeId) }
        : { schoolId },
    });

    // Une fois toutes les heures au même format, l'ordre lexicographique est
    // l'ordre horaire. Comparaisons strictes : un créneau qui commence à
    // l'instant où le précédent se termine ne le chevauche pas.
    const overlap = others.find(
      (other) =>
        start < toFullTime(other.endTime) && toFullTime(other.startTime) < end,
    );
    if (overlap) {
      throw new ConflictException(
        `Ce créneau chevauche « ${overlap.label} » (${overlap.startTime} – ${overlap.endTime}).`,
      );
    }
  }

  async createSlot(schoolId: string, dto: CreateTimeSlotDto): Promise<TimeSlot> {
    await this.assertSlotIsSound(schoolId, dto);

    console.log("log de dto.sequence", dto.sequence)
    const existing = await this.slotRepository.findOne({
      where: { schoolId, sequence: dto.sequence },
    });
    if (existing) {
      throw new ConflictException(
        `Le rang ${dto.sequence} est déjà occupé par « ${existing.label} ».`,
      );
    }

    return await this.slotRepository.save(
      this.slotRepository.create({
        ...dto,
        schoolId,
        startTime: toFullTime(dto.startTime),
        endTime: toFullTime(dto.endTime),
      }),
    );
  }

  async updateSlot(
    slotId: string,
    schoolId: string,
    dto: UpdateTimeSlotDto,
  ): Promise<TimeSlot> {
    const slot = await this.slotRepository.findOne({
      where: { id: slotId, schoolId },
    });
    if (!slot) throw new NotFoundException(`Créneau introuvable (${slotId}).`);

    const merged = { ...slot, ...dto };
    await this.assertSlotIsSound(schoolId, merged, slotId);

    if (dto.sequence !== undefined && dto.sequence !== slot.sequence) {
      const taken = await this.slotRepository.findOne({
        where: { schoolId, sequence: dto.sequence },
      });
      if (taken) {
        throw new ConflictException(
          `Le rang ${dto.sequence} est déjà occupé par « ${taken.label} ».`,
        );
      }
    }

    /**
     * Un créneau transformé en pause perd ses séances : la grille afficherait
     * sinon des cours pendant la récréation. On refuse plutôt que de les
     * supprimer en silence — c'est au directeur de décider.
     */
    if (dto.isBreak && !slot.isBreak) {
      const used = await this.entryRepository.count({
        where: { schoolId, timeSlotId: slotId },
      });
      if (used > 0) {
        throw new ConflictException(
          `Ce créneau accueille ${used} séance(s). Retirez-les avant d'en faire une pause.`,
        );
      }
    }

    Object.assign(slot, dto);
    slot.startTime = toFullTime(slot.startTime);
    slot.endTime = toFullTime(slot.endTime);
    return await this.slotRepository.save(slot);
  }

  async removeSlot(slotId: string, schoolId: string): Promise<void> {
    const slot = await this.slotRepository.findOne({
      where: { id: slotId, schoolId },
    });
    if (!slot) throw new NotFoundException(`Créneau introuvable (${slotId}).`);

    // La cascade en base effacerait les séances sans prévenir : supprimer une
    // ligne d'horaire viderait silencieusement une colonne d'emploi du temps.
    const used = await this.entryRepository.count({
      where: { schoolId, timeSlotId: slotId },
    });
    if (used > 0) {
      throw new ConflictException(
        `Ce créneau accueille ${used} séance(s) et ne peut pas être supprimé.`,
      );
    }

    await this.slotRepository.remove(slot);
  }

  /* ─── Séances ────────────────────────────────────────────────────────── */

  /** Année demandée, sinon l'année active de l'établissement. */
  private async resolveYear(
    schoolId: string,
    academicYearId?: string,
  ): Promise<AcademicYear> {
    const year = academicYearId
      ? await this.yearRepository.findOne({
          where: { id: academicYearId, schoolId },
        })
      : await this.yearRepository.findOne({
          where: { schoolId, isActive: true },
        });

    if (!year) {
      throw new NotFoundException(
        academicYearId
          ? `Année scolaire introuvable (${academicYearId}).`
          : "Aucune année scolaire active. Activez une année avant d'établir l'emploi du temps.",
      );
    }
    return year;
  }

  private toCell(entry: ScheduleEntry): ScheduleCell {
    return {
      id: entry.id,
      dayOfWeek: entry.dayOfWeek,
      timeSlotId: entry.timeSlotId,
      subject: {
        id: entry.teachingAssignment.subject.id,
        name: entry.teachingAssignment.subject.name,
        shortName: entry.teachingAssignment.subject.shortName,
      },
      teacher: {
        id: entry.teacher.id,
        email: entry.teacher.email,
      },
      classRoom: {
        id: entry.classRoom.id,
        name: entry.classRoom.name,
      },
      teachingAssignmentId: entry.teachingAssignmentId,
    };
  }

  private readonly cellRelations = {
    teachingAssignment: { subject: true },
    teacher: true,
    classRoom: true,
  } as const;

  /** Emploi du temps d'une classe. */
  async getClassSchedule(
    schoolId: string,
    classRoomId: string,
    academicYearId?: string,
  ): Promise<ScheduleGrid> {
    const year = await this.resolveYear(schoolId, academicYearId);
    const entries = await this.entryRepository.find({
      where: { schoolId, classRoomId, academicYearId: year.id },
      relations: this.cellRelations,
    });

    return {
      academicYear: { id: year.id, label: year.label },
      slots: await this.findSlots(schoolId),
      entries: entries.map((e) => this.toCell(e)),
    };
  }

  /** Emploi du temps d'un enseignant, toutes classes confondues. */
  async getTeacherSchedule(
    schoolId: string,
    teacherId: string,
    academicYearId?: string,
  ): Promise<ScheduleGrid> {
    const year = await this.resolveYear(schoolId, academicYearId);
    const entries = await this.entryRepository.find({
      where: { schoolId, teacherId, academicYearId: year.id },
      relations: this.cellRelations,
    });

    return {
      academicYear: { id: year.id, label: year.label },
      slots: await this.findSlots(schoolId),
      entries: entries.map((e) => this.toCell(e)),
    };
  }

  /**
   * Les affectations d'une classe, avec le nombre de séances déjà placées.
   *
   * C'est la palette de l'écran de saisie : on ne peut poser que ce qui a été
   * affecté, et le compteur indique où en est le volume horaire de chaque
   * matière.
   */
  async getClassAssignments(
    schoolId: string,
    classRoomId: string,
    academicYearId?: string,
  ): Promise<AssignmentUsage[]> {
    const year = await this.resolveYear(schoolId, academicYearId);

    const assignments = await this.assignmentRepository.find({
      where: { schoolId, classRoomId, academicYearId: year.id },
      relations: { subject: true, teacher: true, classRoom: true },
    });

    const counts = await this.entryRepository
      .createQueryBuilder('entry')
      .select('entry.teachingAssignmentId', 'assignmentId')
      .addSelect('COUNT(*)', 'total')
      .where('entry.schoolId = :schoolId', { schoolId })
      .andWhere('entry.classRoomId = :classRoomId', { classRoomId })
      .andWhere('entry.academicYearId = :yearId', { yearId: year.id })
      .groupBy('entry.teachingAssignmentId')
      .getRawMany<{ assignmentId: string; total: string }>();

    const byAssignment = new Map(
      counts.map((row) => [row.assignmentId, Number(row.total)]),
    );

    return assignments.map((a) => ({
      id: a.id,
      subject: {
        id: a.subject.id,
        name: a.subject.name,
        shortName: a.subject.shortName,
      },
      teacher: { id: a.teacher.id, email: a.teacher.email },
      classRoom: { id: a.classRoom.id, name: a.classRoom.name },
      scheduledCount: byAssignment.get(a.id) ?? 0,
    }));
  }

  /**
   * Traduit une violation d'unicité en message exploitable.
   *
   * La base garantit qu'aucun double placement ne passe ; encore faut-il dire
   * lequel des deux conflits s'est produit, et avec quoi. Sans cela le
   * directeur reçoit un refus sans savoir quelle case libérer.
   */
  private async explainConflict(
    error: unknown,
    schoolId: string,
    academicYearId: string,
    placement: { dayOfWeek: number; timeSlotId: string },
    assignment: TeachingAssignment,
  ): Promise<never> {
    const code = (error as { code?: string })?.code;
    if (code !== UNIQUE_VIOLATION) throw error;

    const clash = await this.entryRepository.findOne({
      where: [
        {
          schoolId,
          academicYearId,
          classRoomId: assignment.classRoomId,
          dayOfWeek: placement.dayOfWeek,
          timeSlotId: placement.timeSlotId,
        },
        {
          schoolId,
          academicYearId,
          teacherId: assignment.teacherId,
          dayOfWeek: placement.dayOfWeek,
          timeSlotId: placement.timeSlotId,
        },
      ],
      relations: this.cellRelations,
    });

    if (clash && clash.classRoomId === assignment.classRoomId) {
      throw new ConflictException(
        `La classe ${clash.classRoom.name} a déjà ${clash.teachingAssignment.subject.name} sur ce créneau.`,
      );
    }
    if (clash) {
      throw new ConflictException(
        `Cet enseignant est déjà en cours avec la ${clash.classRoom.name} sur ce créneau.`,
      );
    }
    throw new ConflictException('Ce créneau est déjà occupé.');
  }

  private async loadSlotForPlacement(
    schoolId: string,
    timeSlotId: string,
  ): Promise<TimeSlot> {
    const slot = await this.slotRepository.findOne({
      where: { id: timeSlotId, schoolId },
    });
    if (!slot) throw new NotFoundException(`Créneau introuvable (${timeSlotId}).`);
    if (slot.isBreak) {
      throw new BadRequestException(
        `« ${slot.label} » est une pause : aucun cours ne peut y être placé.`,
      );
    }
    return slot;
  }

  async createEntry(
    schoolId: string,
    dto: CreateScheduleEntryDto,
  ): Promise<ScheduleEntry> {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: dto.teachingAssignmentId, schoolId },
    });
    if (!assignment) {
      throw new NotFoundException(
        `Affectation introuvable (${dto.teachingAssignmentId}).`,
      );
    }

    await this.loadSlotForPlacement(schoolId, dto.timeSlotId);

    const entry = this.entryRepository.create({
      schoolId,
      // L'année, la classe et l'enseignant viennent de l'affectation et jamais
      // de la requête : c'est ce qui interdit toute divergence entre la séance
      // et le service qu'elle représente.
      academicYearId: assignment.academicYearId,
      classRoomId: assignment.classRoomId,
      teacherId: assignment.teacherId,
      teachingAssignmentId: assignment.id,
      dayOfWeek: dto.dayOfWeek,
      timeSlotId: dto.timeSlotId,
    });

    try {
      return await this.entryRepository.save(entry);
    } catch (error) {
      return await this.explainConflict(
        error,
        schoolId,
        assignment.academicYearId,
        dto,
        assignment,
      );
    }
  }

  async moveEntry(
    entryId: string,
    schoolId: string,
    dto: MoveScheduleEntryDto,
  ): Promise<ScheduleEntry> {
    const entry = await this.entryRepository.findOne({
      where: { id: entryId, schoolId },
      relations: { teachingAssignment: true },
    });
    if (!entry) throw new NotFoundException(`Séance introuvable (${entryId}).`);

    await this.loadSlotForPlacement(schoolId, dto.timeSlotId);

    entry.dayOfWeek = dto.dayOfWeek;
    entry.timeSlotId = dto.timeSlotId;

    try {
      return await this.entryRepository.save(entry);
    } catch (error) {
      return await this.explainConflict(
        error,
        schoolId,
        entry.academicYearId,
        dto,
        entry.teachingAssignment,
      );
    }
  }

  async removeEntry(entryId: string, schoolId: string): Promise<void> {
    const entry = await this.entryRepository.findOne({
      where: { id: entryId, schoolId },
    });
    if (!entry) throw new NotFoundException(`Séance introuvable (${entryId}).`);
    await this.entryRepository.remove(entry);
  }
}
