import { IsNotEmpty, IsNumber, IsPositive, IsString } from 'class-validator';

export class CreatePaymentDto {
  @IsString({ message: 'La référence comptable doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'La référence comptable de l’inscription est obligatoire (ex: INS-26-0001)' })
  reference: string;


  @IsNumber({}, { message: 'Le montant du paiement doit être un nombre' })
  @IsPositive({ message: 'Le montant du paiement doit être supérieur à zéro' })
  @IsNotEmpty({ message: 'Le montant du paiement est obligatoire' })
  amount: number;
}
