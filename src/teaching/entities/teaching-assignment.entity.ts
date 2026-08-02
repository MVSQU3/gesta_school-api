import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AcademicYear } from '../../academic-years/entities/academic-year.entity';
import { ClassRoom } from '../../classrooms/entities/classroom.entity';
import { School } from '../../schools/entities/school.entity';
import { Subject } from '../../subjects/entities/subject.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Affectation d'un enseignant : « M. Koné enseigne les mathématiques en 6ème A
 * pour l'année 2026-2027 ».
 *
 * C'est cette table qui détermine ce qu'un enseignant a le droit de saisir :
 * sans affectation, il ne peut créer aucune évaluation ni noter aucun élève.
 * L'affectation est portée par une année scolaire, les services changeant
 * d'une année sur l'autre.
 */
@Entity('teaching_assignments')
@Unique(['teacherId', 'classRoomId', 'subjectId', 'academicYearId'])
export class TeachingAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({ type: 'uuid' })
  teacherId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teacherId' })
  teacher: User;

  @Column({ type: 'uuid' })
  classRoomId: string;

  @ManyToOne(() => ClassRoom, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'classRoomId' })
  classRoom: ClassRoom;

  @Column({ type: 'uuid' })
  subjectId: string;

  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subjectId' })
  subject: Subject;

  @Column({ type: 'uuid' })
  academicYearId: string;

  @ManyToOne(() => AcademicYear, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academicYearId' })
  academicYear: AcademicYear;

  @CreateDateColumn()
  createdAt: Date;
}
