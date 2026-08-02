import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClassRoom } from '../../classrooms/entities/classroom.entity';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
import { GradingPeriod } from '../../grading-periods/entities/grading-period.entity';
import { School } from '../../schools/entities/school.entity';
import { Subject } from '../../subjects/entities/subject.entity';
import { User } from '../../users/entities/user.entity';

export enum EvaluationType {
  /** Devoir surveillé, toujours noté sur 20. */
  DEVOIR = 'DEVOIR',
  /** Interrogation écrite ou orale, notée sur 10 ou sur 20. */
  INTERROGATION = 'INTERROGATION',
}

/**
 * Une évaluation : un devoir ou une interrogation donné à une classe, dans une
 * matière et sur une période de notation.
 *
 * `maxScore` retient le barème réel (10 ou 20). Les notes sont saisies dans ce
 * barème, puis ramenées sur 20 au moment du calcul des moyennes — sans quoi une
 * interrogation sur 10 pèserait deux fois moins qu'elle ne le devrait.
 */
@Entity('evaluations')
@Index(['classRoomId', 'gradingPeriodId'])
export class Evaluation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

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
  gradingPeriodId: string;

  @ManyToOne(() => GradingPeriod, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gradingPeriodId' })
  gradingPeriod: GradingPeriod;

  @Column({
    type: 'enum',
    enum: EvaluationType,
  })
  type: EvaluationType;

  @Column({ type: 'varchar', length: 100 })
  title: string; // Ex: "Devoir n°1 — Équations du second degré"

  @Column({ type: 'date' })
  date: Date;

  /**
   * Barème de l'évaluation : 20 pour un devoir, 10 ou 20 pour une
   * interrogation. Les notes saisies ne peuvent pas le dépasser.
   */
  @Column({ type: 'int', default: 20 })
  maxScore: number;

  /**
   * Poids de l'évaluation dans la moyenne de la matière. Permet de faire
   * compter un devoir davantage qu'une interrogation, selon l'usage de
   * l'établissement. À 1 partout, la moyenne est une moyenne simple.
   */
  @Column({
    type: 'decimal',
    precision: 4,
    scale: 2,
    default: 1,
    transformer: numericTransformer,
  })
  weight: number;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  createdByUser: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
