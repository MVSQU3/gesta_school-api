import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaymentMethod } from '../entities/payment.entity';

export class QueryPaymentsDto extends PaginationQueryDto {
  /** Début de période, au format AAAA-MM-JJ. Par défaut : aujourd'hui. */
  @IsOptional()
  @IsDateString(
    {},
    { message: 'La date de début doit être au format AAAA-MM-JJ' },
  )
  from?: string;

  /** Fin de période incluse, au format AAAA-MM-JJ. Par défaut : aujourd'hui. */
  @IsOptional()
  @IsDateString({}, { message: 'La date de fin doit être au format AAAA-MM-JJ' })
  to?: string;

  @IsOptional()
  @IsEnum(PaymentMethod, {
    message: 'Le mode de paiement doit être CASH, MOBILE_MONEY ou BANK_TRANSFER',
  })
  method?: PaymentMethod;

  /** Filtre sur un caissier précis. */
  @IsOptional()
  @IsUUID('4', { message: "L'ID du caissier doit être un UUID valide" })
  receivedByUserId?: string;
}

export interface CashJournalSummary {
  /** Période effectivement couverte (bornes incluses). */
  from: string;
  to: string;
  /** Nombre de versements sur la période. */
  count: number;
  /** Total encaissé sur la période, tous modes confondus (hors annulés). */
  totalAmount: number;
  /** Détail par mode de règlement (hors annulés). */
  byMethod: Record<PaymentMethod, { count: number; amount: number }>;
  /** Nombre de versements annulés sur la période. */
  cancelledCount: number;
  /** Montant total annulé sur la période, pour justification. */
  cancelledAmount: number;
}
