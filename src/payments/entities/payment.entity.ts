import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  PrimaryGeneratedColumn,
  ManyToOne,
} from 'typeorm';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
import { Enrollment } from '../../enrollments/entities/enrollment.entity';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

export enum PaymentMethod {
  CASH = 'CASH',
  MOBILE_MONEY = 'MOBILE_MONEY',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

/**
 * Libellés lisibles des modes de règlement, pour les documents destinés à un
 * humain — export tableur, reçu PDF. L'énumération technique ne convient pas :
 * « MOBILE_MONEY » n'a pas sa place sur une pièce comptable.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Espèces',
  [PaymentMethod.MOBILE_MONEY]: 'Mobile Money',
  [PaymentMethod.BANK_TRANSFER]: 'Virement bancaire',
};

export enum CancellationType {
  /** Erreur de saisie : l'argent n'a en réalité jamais été encaissé. */
  ERROR = 'ERROR',
  /** Remboursement : l'argent a été encaissé puis rendu à la famille. */
  REFUND = 'REFUND',
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @Index()
  @Column({ type: 'uuid' })
  enrollmentId: string;

  /**
   * Une inscription peut recevoir plusieurs versements (paiement par tranches).
   * Le solde restant dû se calcule à partir de Enrollment.totalDue diminué de
   * la somme des versements rattachés.
   */
  @ManyToOne(() => Enrollment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrollmentId' })
  enrollment: Enrollment;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: false,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
    default: PaymentMethod.CASH,
  })
  method: PaymentMethod;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
    nullable: false,
  })
  receiptNumber: string; // Ex: REC-CMB-26-0001

  /**
   * Caissier ayant encaissé le versement. Nullable : les paiements enregistrés
   * avant l'introduction de la traçabilité n'en portent pas.
   */
  @Column({ type: 'uuid', nullable: true })
  receivedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'receivedByUserId' })
  receivedByUser: User | null;

  @CreateDateColumn()
  paidAt: Date;

  /**
   * Date d'annulation. Un versement annulé n'est jamais supprimé : la ligne
   * reste en base, son numéro de reçu reste consommé, et elle continue
   * d'apparaître dans le journal de caisse — barrée. Elle est en revanche
   * exclue de tous les totaux et du calcul du solde.
   *
   * `null` tant que le versement est valide.
   */
  @Index()
  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @Column({
    type: 'enum',
    enum: CancellationType,
    nullable: true,
  })
  cancellationType: CancellationType | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancellationReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cancelledByUserId' })
  cancelledByUser: User | null;
}
