import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AcademicYear } from '../../academic-years/entities/academic-year.entity';
import { ClassRoom } from '../../classrooms/entities/classroom.entity';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
import { School } from '../../schools/entities/school.entity';
import { Student } from '../../students/entities/student.entity';
import { User } from '../../users/entities/user.entity';

export enum EnrollmentStatus {
  /** Aucun versement reçu — le jeton 72h court toujours. */
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  /** Au moins un versement reçu, solde restant dû — la place est sécurisée. */
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  /** Scolarité intégralement réglée. */
  ENROLLED = 'ENROLLED',
  /** Délai de 72h dépassé sans aucun versement. */
  EXPIRED = 'EXPIRED',
}

/**
 * Libellés lisibles des statuts, pour les documents destinés à un humain.
 * « PARTIALLY_PAID » n'a pas sa place dans un tableau remis à la direction.
 */
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  [EnrollmentStatus.PENDING_PAYMENT]: 'En attente de paiement',
  [EnrollmentStatus.PARTIALLY_PAID]: 'Partiellement réglé',
  [EnrollmentStatus.ENROLLED]: 'Intégralement réglé',
  [EnrollmentStatus.EXPIRED]: 'Expiré',
};

@Entity('enrollments')
export class Enrollment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @Column({ type: 'uuid' })
  studentId: string;

  @Column({ type: 'uuid' })
  classRoomId: string;

  @Column({ type: 'uuid' })
  academicYearId: string;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
    nullable: false,
  })
  reference: string; // Ex: INS-CMB-26-0001 (Avec le slug de l'école)

  @Column({
    type: 'enum',
    enum: EnrollmentStatus,
    default: EnrollmentStatus.PENDING_PAYMENT,
  })
  status: EnrollmentStatus;

  @Column({
    type: 'timestamp',
    nullable: false,
  })
  expiresAt: Date;

  /**
   * Montant total dû pour cette inscription, en FCFA.
   * Recopié depuis ClassRoom.tuitionFee à la création : le dossier conserve le
   * tarif en vigueur ce jour-là, indépendamment des révisions ultérieures.
   */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalDue: number;

  /**
   * Auteur de la saisie (secrétaire ou directeur). Nullable : les dossiers
   * créés avant l'introduction de la traçabilité n'en portent pas.
   */
  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  createdByUser: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @ManyToOne(() => ClassRoom, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'classRoomId' })
  classRoom: ClassRoom;

  @ManyToOne(() => AcademicYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'academicYearId' })
  academicYear: AcademicYear;
}
