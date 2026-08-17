import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * Un créneau de la grille horaire de l'établissement.
 *
 * La grille est définie une fois par l'école — « 7h30-8h25 », « 8h25-9h20 »,
 * « récréation »… — puis les séances viennent s'y poser. Des horaires libres
 * par séance auraient été plus souples, mais la grille régulière est ce qui
 * rend l'emploi du temps lisible d'un coup d'œil et les conflits détectables
 * par une simple contrainte d'unicité.
 *
 * Les créneaux appartiennent à l'école et non à l'année scolaire : une école
 * change rarement ses horaires, et les redéfinir chaque année serait une
 * corvée annuelle sans contrepartie.
 */
@Entity('time_slots')
@Unique(['schoolId', 'sequence'])
export class TimeSlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  /** Libellé affiché. Ex : « 1ère heure », « Récréation ». */
  @Column({ type: 'varchar', length: 40 })
  label: string;

  /** Heure de début, au format HH:MM:SS. */
  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  /** Rang dans la journée. Ordonne la grille et garantit son unicité. */
  @Column({ type: 'int' })
  sequence: number;

  /**
   * Pause : récréation, déjeuner. Occupe une ligne de la grille pour que
   * l'emploi du temps reflète la journée réelle, mais n'accueille aucune
   * séance — programmer un cours pendant la récréation n'aurait pas de sens.
   */
  @Column({ type: 'boolean', default: false })
  isBreak: boolean;
}
