import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ClassRoom } from '../../classrooms/entities/classroom.entity';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
import { School } from '../../schools/entities/school.entity';
import { Subject } from './subject.entity';

/**
 * Programme d'une classe : la liste des matières qui y sont enseignées, avec
 * le coefficient de chacune.
 *
 * C'est ce coefficient qui pondère la moyenne générale de l'élève :
 *   moyenne générale = Σ (moyenne matière × coefficient) / Σ coefficients
 */
@Entity('classroom_subjects')
@Unique(['classRoomId', 'subjectId'])
export class ClassRoomSubject {
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

  /** Coefficient de la matière dans cette classe (décimal pour les demi-coefficients). */
  @Column({
    type: 'decimal',
    precision: 4,
    scale: 2,
    default: 1,
    transformer: numericTransformer,
  })
  coefficient: number;
}
