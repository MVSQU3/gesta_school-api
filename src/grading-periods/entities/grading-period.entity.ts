import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AcademicYear } from '../../academic-years/entities/academic-year.entity';
import { School } from '../../schools/entities/school.entity';

/**
 * Période de notation d'une année scolaire : trimestre ou semestre selon le
 * découpage retenu par l'établissement.
 *
 * Les périodes sont générées à l'ouverture de l'année scolaire (3 pour un
 * établissement au trimestre, 2 au semestre) puis ajustables par la direction.
 */
@Entity('grading_periods')
@Unique(['academicYearId', 'sequence'])
export class GradingPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Column({ type: 'uuid' })
  academicYearId: string;

  @ManyToOne(() => AcademicYear, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academicYearId' })
  academicYear: AcademicYear;

  @Column({ type: 'varchar', length: 50 })
  label: string; // Ex: "1er Trimestre", "2e Semestre"

  /** Rang de la période dans l'année : 1, 2, 3. */
  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'date', nullable: true })
  startDate: Date | null;

  @Column({ type: 'date', nullable: true })
  endDate: Date | null;

  /**
   * Une période close n'accepte plus de saisie de notes : les bulletins
   * édités ne peuvent plus être contredits après coup.
   */
  @Column({ type: 'boolean', default: false })
  isClosed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
