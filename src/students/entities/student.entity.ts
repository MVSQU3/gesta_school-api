import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Enrollment } from '../../enrollments/entities/enrollment.entity';
import { School } from '../../schools/entities/school.entity';

@Entity('students')
// Sert la recherche d'un élève existant au moment de la réinscription.
@Index(['schoolId', 'lastName', 'firstName'])
export class Student {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Établissement de rattachement.
   *
   * L'élève était auparavant global, ce qui posait deux problèmes : supprimer
   * une école laissait ses élèves orphelins en base, et rien ne cloisonnait
   * les élèves entre établissements. Un enfant scolarisé successivement dans
   * deux écoles a désormais une fiche par école.
   */
  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: false,
  })
  firstName: string;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: false,
  })
  lastName: string;

  @Column({
    type: 'date',
    nullable: false,
  })
  birthDay: Date;

  @Column({
    type: 'varchar',
    length: 15,
    nullable: false,
  })
  parentPhone: string;

  @Column({
    type: 'timestamp',
    nullable: false,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @OneToMany(() => Enrollment, (enrollment) => enrollment.student)
  enrollments: Enrollment[];
}

