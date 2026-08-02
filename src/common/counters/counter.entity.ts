import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

export enum CounterScope {
  ENROLLMENT = 'ENROLLMENT',
  RECEIPT = 'RECEIPT',
}

/**
 * Compteur séquentiel persistant, cloisonné par école, par type de document
 * et par année civile.
 *
 * Remplace l'ancien calcul `count(...) + 1`, qui posait deux problèmes :
 *  - le renouvellement d'un dossier ("Clonage Fantôme") ne crée aucune ligne,
 *    donc deux renouvellements successifs produisaient la même référence ;
 *  - deux requêtes simultanées lisaient le même total et généraient un doublon.
 */
@Entity('counters')
@Unique(['schoolId', 'scope', 'year'])
export class Counter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({
    type: 'enum',
    enum: CounterScope,
  })
  scope: CounterScope;

  @Column({ type: 'int' })
  year: number; // Année civile sur 4 chiffres (ex: 2026)

  @Column({ type: 'int', default: 0 })
  lastValue: number;
}
