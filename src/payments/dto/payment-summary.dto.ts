import { EnrollmentBalance } from '../../common/balance/balance.service';
import { Payment } from '../entities/payment.entity';

/**
 * Réponse d'un encaissement : le versement enregistré, augmenté de la
 * situation financière du dossier après opération (pour le reçu).
 */
export interface PaymentResult extends Payment {
  balanceAfter: EnrollmentBalance;
}
