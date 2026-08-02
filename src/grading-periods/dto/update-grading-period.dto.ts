import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateGradingPeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Le libellé ne peut pas dépasser 50 caractères' })
  label?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La date de début doit être au format AAAA-MM-JJ' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La date de fin doit être au format AAAA-MM-JJ' })
  endDate?: string;

  /** Une période close n'accepte plus de saisie de notes. */
  @IsOptional()
  @IsBoolean({ message: 'Le statut de clôture doit être un booléen' })
  isClosed?: boolean;
}
