import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Nature de l'opération tracée.
 *
 * Les encaissements n'y figurent pas : ils portent déjà leur propre
 * traçabilité — caissier, date, annulation avec motif et auteur — directement
 * sur la ligne de paiement, qui est une pièce comptable. Ce journal couvre
 * tout le reste, c'est-à-dire les décisions administratives : qui a changé un
 * tarif, ouvert ou fermé un compte, corrigé un dossier, clôturé une période.
 */
export enum AuditAction {
  // Tarifs et classes
  CLASSROOM_CREATED = 'CLASSROOM_CREATED',
  CLASSROOM_UPDATED = 'CLASSROOM_UPDATED',
  CLASSROOM_DELETED = 'CLASSROOM_DELETED',

  // Comptes du personnel
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_STATUS_CHANGED = 'USER_STATUS_CHANGED',
  USER_PASSWORD_RESET = 'USER_PASSWORD_RESET',
  USER_DELETED = 'USER_DELETED',

  // Dossiers et élèves
  ENROLLMENT_UPDATED = 'ENROLLMENT_UPDATED',
  ENROLLMENT_DELETED = 'ENROLLMENT_DELETED',
  ENROLLMENT_RENEWED = 'ENROLLMENT_RENEWED',
  ENROLLMENT_BULK_CREATED = 'ENROLLMENT_BULK_CREATED',
  STUDENT_UPDATED = 'STUDENT_UPDATED',

  // Année scolaire et notation
  ACADEMIC_YEAR_CREATED = 'ACADEMIC_YEAR_CREATED',
  ACADEMIC_YEAR_UPDATED = 'ACADEMIC_YEAR_UPDATED',
  GRADING_PERIOD_UPDATED = 'GRADING_PERIOD_UPDATED',

  // Établissements (super-administrateur)
  SCHOOL_CREATED = 'SCHOOL_CREATED',
  SCHOOL_UPDATED = 'SCHOOL_UPDATED',
  SCHOOL_DELETED = 'SCHOOL_DELETED',
}

/** Valeur d'un champ avant et après modification. */
export interface AuditChange {
  before: unknown;
  after: unknown;
}

/**
 * Journal d'audit des opérations administratives.
 *
 * Table en ajout seul : rien dans l'application ne modifie ni ne supprime une
 * ligne d'audit. Un journal qu'on peut retoucher ne prouve rien.
 */
@Entity('audit_logs')
@Index(['schoolId', 'createdAt'])
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Établissement concerné. `null` pour les opérations du
   * super-administrateur qui portent sur les établissements eux-mêmes.
   */
  @Column({ type: 'uuid', nullable: true })
  schoolId: string | null;

  @ManyToOne(() => School, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actorUser: User | null;

  /**
   * Adresse de l'auteur, recopiée au moment de l'écriture.
   *
   * Volontairement dénormalisée : le compte peut être supprimé plus tard, et
   * la relation passerait alors à `null`. Un journal qui perd le nom de
   * l'auteur quand celui-ci quitte l'établissement ne sert précisément à rien
   * dans le cas où on le consulte.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail: string | null;

  @Column({ type: 'varchar', length: 60 })
  action: AuditAction;

  /** Table concernée, en clair : `classrooms`, `users`, `enrollments`… */
  @Column({ type: 'varchar', length: 40 })
  entityType: string;

  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  /**
   * Phrase lisible décrivant l'opération, composée à l'écriture.
   *
   * « Tarif de la 6ème A porté de 120 000 à 130 000 FCFA » se lit sans
   * connaître le schéma de la base — c'est ce qu'on veut sous les yeux du
   * directeur ou d'un contrôleur, plutôt qu'un diff technique à déchiffrer.
   */
  @Column({ type: 'varchar', length: 255 })
  summary: string;

  /**
   * Détail champ par champ, `{ tuitionFee: { before, after } }`.
   * Complète le résumé sans le remplacer, pour les cas où il faut la valeur
   * exacte d'avant.
   */
  @Column({ type: 'jsonb', nullable: true })
  changes: Record<string, AuditChange> | null;

  @CreateDateColumn()
  createdAt: Date;
}
