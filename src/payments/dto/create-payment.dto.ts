import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { PaymentMethod } from '../entities/payment.entity';

export class CreatePaymentDto {
  @IsString({ message: 'La référence comptable doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'La référence comptable de l’inscription est obligatoire (ex: INS-26-0001)' })
  reference: string;

  /**
   * Montant du versement. Peut être inférieur au total dû : le solde restant
   * pourra être réglé par un ou plusieurs versements ultérieurs.
   */
  @IsNumber({}, { message: 'Le montant du paiement doit être un nombre' })
  @IsPositive({ message: 'Le montant du paiement doit être supérieur à zéro' })
  @IsNotEmpty({ message: 'Le montant du paiement est obligatoire' })
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMethod, {
    message: 'Le mode de paiement doit être CASH, MOBILE_MONEY ou BANK_TRANSFER',
  })
  method?: PaymentMethod;
}
