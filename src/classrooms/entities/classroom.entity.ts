import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
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

  /**
   * Frais de scolarité annuels de la classe, en FCFA.
   * Sert de référence au montant dû lors de l'inscription ; la valeur est
   * recopiée sur l'inscription au moment de la saisie, si bien qu'une révision
   * ultérieure du tarif ne modifie pas les dossiers déjà ouverts.
   */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  tuitionFee: number;

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
