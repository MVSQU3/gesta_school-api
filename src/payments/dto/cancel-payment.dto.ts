import { IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { CancellationType } from '../entities/payment.entity';

export class CancelPaymentDto {
  @IsEnum(CancellationType, {
    message:
      "Le motif doit être ERROR (erreur de saisie) ou REFUND (remboursement)",
  })
  type: CancellationType;

  /**
   * Justification obligatoire : une annulation de caisse doit toujours pouvoir
   * être expliquée lors d'un contrôle.
   */
  @IsString({ message: 'Le motif doit être une chaîne de caractères' })
  @IsNotEmpty({ message: "Le motif de l'annulation est obligatoire" })
  @MinLength(5, { message: 'Le motif doit comporter au moins 5 caractères' })
  @MaxLength(255, { message: 'Le motif ne peut pas dépasser 255 caractères' })
  reason: string;
}
