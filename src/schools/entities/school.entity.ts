import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Découpage de l'année scolaire. Certains établissements fonctionnent au
 * trimestre (3 périodes), d'autres au semestre (2 périodes).
 */
export enum PeriodSystem {
  TRIMESTER = 'TRIMESTER',
  SEMESTER = 'SEMESTER',
}

@Entity('schools')
export class School {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: false,
  })
  name: string; // Ex: "Collège Moderne de Bouaké"

  @Column({
    type: 'varchar',
    length: 10,
    unique: true,
    nullable: false,
  })
  slug: string; // Ex: "CMB" (Utilisé pour préfixer les références: INS-CMB-26-0001)

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  address: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  phone: string;

  /**
   * Découpage de l'année scolaire retenu par l'établissement. Détermine le
   * nombre de périodes de notation créées à l'ouverture d'une année scolaire.
   */
  @Column({
    type: 'enum',
    enum: PeriodSystem,
    default: PeriodSystem.TRIMESTER,
  })
  periodSystem: PeriodSystem;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;
}
