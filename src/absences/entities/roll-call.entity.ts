import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ScheduleEntry } from '../../schedule/entities/schedule-entry.entity';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Trace qu'un appel a eu lieu pour une séance, à une date donnée.
 *
 * « Présent » n'étant pas enregistré — c'est l'absence de ligne dans
 * `absences` — une séance où tout le monde est là ne laissait rien derrière
 * elle. La base se retrouvait dans le même état que si l'appel n'avait jamais
 * été fait, et personne ne pouvait distinguer les deux.
 *
 * Cette table ne stocke pas les présents un par un : trente lignes par heure
 * de cours et par classe seraient absurdes pour une information qui se déduit.
 * Elle enregistre le seul fait qui manquait — l'appel a été fait, par qui, et
 * quand — ce qui permet à la direction de lister les appels **non faits**.
 *
 * `CASCADE` sur la séance, contrairement aux absences qui survivent en
 * `SET NULL` : une absence est un fait constaté sur un élève, elle garde sa
 * valeur même si le créneau disparaît de la grille ; « l'appel a été fait sur
 * ce créneau » ne veut plus rien dire quand le créneau n'existe plus.
 */
@Entity('roll_calls')
@Unique('UQ_roll_calls_session_date', ['scheduleEntryId', 'date'])
@Index(['schoolId', 'date'])
export class RollCall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({ type: 'uuid' })
  scheduleEntryId: string;

  @ManyToOne(() => ScheduleEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scheduleEntryId' })
  scheduleEntry: ScheduleEntry;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'uuid', nullable: true })
  takenByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'takenByUserId' })
  takenByUser: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
