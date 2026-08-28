import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Enrollment } from '../../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../../grading-periods/entities/grading-period.entity';
import { ScheduleEntry } from '../../schedule/entities/schedule-entry.entity';
import { TimeSlot } from '../../schedule/entities/time-slot.entity';
import { School } from '../../schools/entities/school.entity';
import { Subject } from '../../subjects/entities/subject.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Ce qui est constaté pour un élève sur une séance.
 *
 * « Présent » n'est pas une valeur : c'est l'absence de ligne. Seuls les
 * écarts sont enregistrés, ce qui évite d'écrire une ligne par élève et par
 * heure de cours de l'année.
 */
export enum AbsenceStatus {
  ABSENT = 'ABSENT',
  /** Arrivé après le début du cours. */
  LATE = 'LATE',
}

/**
 * Absence ou retard d'un élève sur **une séance de cours**.
 *
 * L'assiduité était auparavant relevée par demi-journée, sans lien avec
 * l'emploi du temps : on savait qu'un élève avait manqué la matinée, jamais
 * quel cours. Elle se rattache désormais à un créneau de l'emploi du temps,
 * ce qui donne d'un coup le professeur, la matière et l'horaire — et permet à
 * chaque enseignant de ne faire l'appel que dans ses propres cours.
 *
 * Trois colonnes sont recopiées à la saisie plutôt que lues par jointure :
 *
 *  - `subjectId` et `timeSlotId`, parce que l'emploi du temps est réorganisé
 *    en cours d'année ; l'assiduité passée ne doit pas se réécrire quand une
 *    heure change de place ;
 *  - `scheduleEntryId` reste, mais en `SET NULL` : supprimer un créneau ne
 *    doit pas effacer les absences qui y ont été constatées.
 */
@Entity('absences')
// Un élève ne peut avoir qu'un statut par séance : le créneau et la date
// suffisent à l'identifier, deux cours ne pouvant se superposer.
@Unique('UQ_absences_enrollment_date_slot', ['enrollmentId', 'date', 'timeSlotId'])
@Index(['schoolId', 'date'])
// Sert la vue « par matière » de la direction.
@Index(['schoolId', 'subjectId'])
export class Absence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({ type: 'uuid' })
  enrollmentId: string;

  @ManyToOne(() => Enrollment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrollmentId' })
  enrollment: Enrollment;

  /**
   * Séance de l'emploi du temps. Nul si le créneau a été supprimé depuis :
   * le constat reste, le lien vers l'horaire disparaît.
   */
  @Column({ type: 'uuid', nullable: true })
  scheduleEntryId: string | null;

  @ManyToOne(() => ScheduleEntry, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'scheduleEntryId' })
  scheduleEntry: ScheduleEntry | null;

  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subjectId' })
  subject: Subject;

  @Column({ type: 'uuid' })
  timeSlotId: string;

  @ManyToOne(() => TimeSlot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'timeSlotId' })
  timeSlot: TimeSlot;

  /**
   * Période de notation, figée à la saisie pour que le cumul du bulletin reste
   * stable même si les bornes de période sont ajustées ensuite.
   */
  @Column({ type: 'uuid', nullable: true })
  gradingPeriodId: string | null;

  @ManyToOne(() => GradingPeriod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'gradingPeriodId' })
  gradingPeriod: GradingPeriod | null;

  @Column({ type: 'date' })
  date: Date;

  @Column({
    type: 'enum',
    enum: AbsenceStatus,
    default: AbsenceStatus.ABSENT,
  })
  status: AbsenceStatus;

  @Column({ type: 'boolean', default: false })
  isJustified: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'uuid', nullable: true })
  recordedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recordedByUserId' })
  recordedByUser: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
