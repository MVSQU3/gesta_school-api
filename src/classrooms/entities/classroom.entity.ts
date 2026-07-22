import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

export enum ClassRoomLevel {
  COLLEGE = 'COLLEGE',
  LYCEE = 'LYCEE',
}

@Entity('classrooms')
export class ClassRoom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: false,
  })
  name: string; // Ex: "6ème A"

  @Column({
    type: 'enum',
    enum: ClassRoomLevel,
    default: ClassRoomLevel.COLLEGE,
  })
  level: ClassRoomLevel;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  // Relation Multi-Tenant
  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;
}
