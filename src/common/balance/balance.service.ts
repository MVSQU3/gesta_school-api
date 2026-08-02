import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  Enrollment,
  EnrollmentStatus,
} from '../../enrollments/entities/enrollment.entity';
import { Payment } from '../../payments/entities/payment.entity';

export interface EnrollmentBalance {
  /** Montant total dû, figé à la création de l'inscription. */
  totalDue: number;
  /** Somme des versements déjà encaissés. */
  amountPaid: number;
  /** Reste à payer (jamais négatif). */
  balance: number;
  /** Vrai lorsque la scolarité est intégralement réglée. */
  isFullyPaid: boolean;
  status: EnrollmentStatus;
}

/**
 * Calcul du solde d'une inscription.
 *
 * Isolé ici pour que la caisse (au moment d'encaisser) et le secrétariat
 * (au moment de consulter un dossier) partagent exactement la même règle.
 */
@Injectable()
export class BalanceService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  /**
   * Somme des versements valides d'une inscription.
   *
   * Les versements annulés (`cancelledAt` renseigné) sont exclus : qu'il
   * s'agisse d'une erreur de saisie ou d'un remboursement, la somme ne
   * correspond plus à de l'argent acquis par l'établissement.
   *
   * @param manager EntityManager optionnel, pour lire à l'intérieur d'une
   *                transaction en cours (et donc sous le verrou déjà posé).
   */
  async sumPayments(
    enrollmentId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const executor = manager ?? this.paymentRepository.manager;
    const row = await executor
      .createQueryBuilder(Payment, 'payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('payment.enrollmentId = :enrollmentId', { enrollmentId })
      .andWhere('payment.cancelledAt IS NULL')
      .getRawOne<{ total: string }>();

    return Number(row?.total ?? 0);
  }

  /**
   * Situation financière complète d'une inscription.
   */
  async compute(
    enrollment: Enrollment,
    manager?: EntityManager,
  ): Promise<EnrollmentBalance> {
    const totalDue = Number(enrollment.totalDue) || 0;
    const amountPaid = await this.sumPayments(enrollment.id, manager);

    return {
      totalDue,
      amountPaid,
      balance: Math.max(totalDue - amountPaid, 0),
      // Un total dû à 0 signifie qu'aucun tarif n'est configuré pour la classe.
      isFullyPaid: totalDue > 0 && amountPaid >= totalDue,
      status: enrollment.status,
    };
  }
}
