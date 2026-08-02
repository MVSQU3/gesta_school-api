import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { nullableNumericTransformer } from '../../common/transformers/numeric.transformer';
import { Enrollment } from '../../enrollments/entities/enrollment.entity';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { Evaluation } from './evaluation.entity';

/**
 * Note d'un élève à une évaluation.
 *
 * La note est rattachée à l'inscription et non à l'élève : l'inscription porte
 * déjà l'école, la classe et l'année scolaire, ce qui garantit qu'on ne peut
 * pas noter un élève dans une classe où il n'est pas inscrit.
 *
 * `score` est exprimé dans le barème de l'évaluation (sur 10 ou sur 20). La
 * conversion sur 20 se fait au calcul des moyennes.
 */
@Entity('grades')
@Unique(['evaluationId', 'enrollmentId'])
export class Grade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({ type: 'uuid' })
  evaluationId: string;

  @ManyToOne(() => Evaluation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evaluationId' })
  evaluation: Evaluation;

  @Column({ type: 'uuid' })
  enrollmentId: string;

  @ManyToOne(() => Enrollment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrollmentId' })
  enrollment: Enrollment;

  /**
   * Note obtenue, dans le barème de l'évaluation.
   * `null` lorsque l'élève était absent : l'évaluation ne compte alors pas
   * dans sa moyenne, plutôt que d'être comptée comme un zéro.
   */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  score: number | null;

  /** Absent à l'évaluation : la note est neutralisée, pas comptée comme zéro. */
  @Column({ type: 'boolean', default: false })
  isAbsent: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  comment: string | null;

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
