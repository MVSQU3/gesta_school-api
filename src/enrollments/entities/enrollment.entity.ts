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
import { School } from '../../schools/entities/school.entity';
import { Student } from '../../students/entities/student.entity';

export enum EnrollmentStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  ENROLLED = 'ENROLLED',
  EXPIRED = 'EXPIRED',
}

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
