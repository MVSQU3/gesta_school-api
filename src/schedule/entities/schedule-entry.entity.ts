import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AcademicYear } from '../../academic-years/entities/academic-year.entity';
import { ClassRoom } from '../../classrooms/entities/classroom.entity';
import { School } from '../../schools/entities/school.entity';
import { TeachingAssignment } from '../../teaching/entities/teaching-assignment.entity';
import { User } from '../../users/entities/user.entity';
import { TimeSlot } from './time-slot.entity';

/** Jours ouvrés, numérotés pour ordonner la grille. */
export enum DayOfWeek {
  MONDAY = 1,
  TUESDAY = 2,
  WEDNESDAY = 3,
  THURSDAY = 4,
  FRIDAY = 5,
}

/**
 * Une séance de l'emploi du temps : « le mardi, 2ème heure, la 6ème A a maths
 * avec M. Koné ».
 *
 * La séance ne désigne pas directement un enseignant et une matière : elle
 * pointe une **affectation** (`TeachingAssignment`), qui porte déjà le triplet
 * enseignant + matière + classe validé pour l'année. On ne peut donc pas
 * programmer un enseignant sur une matière qu'il n'enseigne pas, ni dans une
 * classe qui ne lui est pas confiée — l'incohérence est rendue impossible
 * plutôt que contrôlée après coup.
 *
 * La grille est hebdomadaire et se répète toute l'année. Les séances
 * exceptionnelles (rattrapage, devoir surveillé) ne sont pas modélisées ici :
 * elles relèveraient d'un calendrier daté, qui est un autre objet.
 */
@Entity('schedule_entries')
// Une classe ne peut avoir qu'une séance sur un créneau donné, et un
// enseignant ne peut être qu'à un endroit à la fois. Ces deux contraintes sont
// posées en base et non dans le service : c'est ce qui rend le double
// placement réellement impossible, y compris sur deux requêtes simultanées.
@Unique('UQ_schedule_class_slot', [
  'academicYearId',
  'classRoomId',
  'dayOfWeek',
  'timeSlotId',
])
@Unique('UQ_schedule_teacher_slot', [
  'academicYearId',
  'teacherId',
  'dayOfWeek',
  'timeSlotId',
])
// Sert l'affichage de la grille d'une classe, la requête la plus fréquente.
@Index(['schoolId', 'academicYearId', 'classRoomId'])
export class ScheduleEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({ type: 'uuid' })
  academicYearId: string;

  @ManyToOne(() => AcademicYear, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academicYearId' })
  academicYear: AcademicYear;

  /**
   * Affectation programmée. Sa suppression emporte la séance : un enseignant
   * qui n'a plus la classe ne doit pas rester à l'emploi du temps.
   */
  @Column({ type: 'uuid' })
  teachingAssignmentId: string;

  @ManyToOne(() => TeachingAssignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teachingAssignmentId' })
  teachingAssignment: TeachingAssignment;

  /**
   * Classe et enseignant recopiés depuis l'affectation.
   *
   * Redondants par rapport à `teachingAssignment`, mais indispensables : une
   * contrainte d'unicité ne peut porter que sur des colonnes de la table. Sans
   * eux, le double placement ne serait vérifiable qu'en applicatif, donc
   * contournable en concurrence. Ils sont toujours écrits d'après
   * l'affectation, jamais d'après la requête, et ne peuvent donc pas diverger.
   */
  @Column({ type: 'uuid' })
  classRoomId: string;

  @ManyToOne(() => ClassRoom, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'classRoomId' })
  classRoom: ClassRoom;

  @Column({ type: 'uuid' })
  teacherId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacherId' })
  teacher: User;

  @Column({ type: 'int' })
  dayOfWeek: DayOfWeek;

  @Column({ type: 'uuid' })
  timeSlotId: string;

  @ManyToOne(() => TimeSlot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'timeSlotId' })
  timeSlot: TimeSlot;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;
}
