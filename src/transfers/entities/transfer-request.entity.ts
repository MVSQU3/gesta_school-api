import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Student } from '../../students/entities/student.entity';
import { User } from '../../users/entities/user.entity';

export enum TransferStatus {
  /** Demande émise, en attente de la décision de l'école détentrice. */
  PENDING = 'PENDING',
  /** Accordée : l'école demandeuse peut lire les bulletins jusqu'à expiration. */
  APPROVED = 'APPROVED',
  /** Refusée par l'école détentrice. Aucune donnée n'a été transmise. */
  REJECTED = 'REJECTED',
  /** Accordée puis coupée avant son terme par l'école détentrice. */
  REVOKED = 'REVOKED',
}

/**
 * Demande de consultation du dossier scolaire d'un élève par une autre école.
 *
 * Un élève qui change d'établissement possède une fiche dans chacun : les
 * données ne se déplacent pas, c'est le droit de les lire qui se demande. La
 * demande matérialise ce droit, et son statut fait foi à chaque lecture.
 *
 * L'accès accordé est délibérément borné : il couvre le temps de l'inscription,
 * pas la scolarité entière. Une école qui a besoin de reconsulter refait une
 * demande — c'est une trace de plus, pas une gêne.
 */
@Entity('transfer_requests')
// Les deux écrans de l'écran Transferts : mes demandes, et celles reçues.
@Index(['requestingSchoolId', 'status'])
@Index(['holdingSchoolId', 'status'])
export class TransferRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** École qui demande à lire le dossier — celle qui accueille l'élève. */
  @Column({ type: 'uuid' })
  requestingSchoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestingSchoolId' })
  requestingSchool: School;

  /** École qui détient le dossier — celle que l'élève quitte. */
  @Column({ type: 'uuid' })
  holdingSchoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'holdingSchoolId' })
  holdingSchool: School;

  /**
   * Fiche visée, chez l'école détentrice.
   *
   * `CASCADE` : si l'école détentrice supprime la fiche, l'autorisation de la
   * lire n'a plus d'objet et disparaît avec elle.
   */
  @Column({ type: 'uuid' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  @Column({
    type: 'enum',
    enum: TransferStatus,
    default: TransferStatus.PENDING,
  })
  status: TransferStatus;

  /** Motif de la demande, saisi par l'école demandeuse. */
  @Column({ type: 'varchar', length: 500 })
  reason: string;

  /** Motif du refus ou de la révocation, saisi par l'école détentrice. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  decisionReason: string | null;

  @Column({ type: 'uuid' })
  requestedById: string;

  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'requestedById' })
  requestedBy: User;

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'decidedById' })
  decidedBy: User | null;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt: Date | null;

  /**
   * Terme de l'accès. Renseigné à l'acceptation seulement.
   *
   * Passée cette date la demande reste `APPROVED` en base : on garde la trace
   * qu'un accès a bien été accordé, et c'est la lecture qui vérifie le terme.
   * Écraser le statut ferait disparaître l'historique de la décision.
   */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;
}
