import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * Matière enseignée dans l'établissement (Mathématiques, Français, SVT…).
 *
 * Le coefficient n'est volontairement pas porté ici : il varie d'une classe à
 * l'autre pour une même matière (les mathématiques ne pèsent pas le même poids
 * en série A qu'en série C). Il est porté par ClassRoomSubject.
 */
@Entity('subjects')
@Unique(['schoolId', 'name'])
export class Subject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({ type: 'varchar', length: 60 })
  name: string; // Ex: "Mathématiques"

  /** Abréviation utilisée sur le bulletin, où la place manque. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  shortName: string | null; // Ex: "MATH"

  @CreateDateColumn()
  createdAt: Date;
}
