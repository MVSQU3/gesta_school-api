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
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

export enum HalfDay {
  MORNING = 'MORNING',
  AFTERNOON = 'AFTERNOON',
}

/**
 * Absence d'un élève sur une demi-journée.
 *
 * La demi-journée est la granularité retenue : elle distingue une absence
 * matinale d'une journée entière sans exiger d'emploi du temps. Deux lignes
 * pour une même date valent une journée complète.
 *
 * La période de notation est enregistrée à la saisie pour que le cumul du
 * bulletin reste stable même si les dates de période sont ajustées ensuite.
 */
@Entity('absences')
@Unique(['enrollmentId', 'date', 'halfDay'])
@Index(['schoolId', 'date'])
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

  @Column({ type: 'uuid', nullable: true })
  gradingPeriodId: string | null;

  @ManyToOne(() => GradingPeriod, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'gradingPeriodId' })
  gradingPeriod: GradingPeriod | null;

  @Column({ type: 'date' })
  date: Date;

  @Column({
    type: 'enum',
    enum: HalfDay,
  })
  halfDay: HalfDay;

  /**
   * Absence justifiée. Les bulletins distinguent les deux cumuls : c'est
   * l'absence injustifiée qui compte dans l'appréciation.
   */
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
