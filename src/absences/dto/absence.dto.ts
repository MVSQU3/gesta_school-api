import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { HalfDay } from '../entities/absence.entity';

export class AbsenceEntryDto {
  @IsUUID('4', { message: "L'identifiant de l'inscription doit être un UUID valide" })
  enrollmentId: string;

  @IsEnum(HalfDay, { message: 'La demi-journée doit être MORNING ou AFTERNOON' })
  halfDay: HalfDay;

  @IsOptional()
  @IsBoolean({ message: 'Le caractère justifié doit être un booléen' })
  isJustified?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Le motif ne peut pas dépasser 255 caractères' })
  reason?: string;
}

/**
 * Appel d'une classe : on enregistre les absents d'une date en une fois.
 * Les élèves non listés sont considérés présents ; leurs absences
 * éventuellement déjà saisies pour cette date sont retirées.
 */
export class RecordAbsencesDto {
  @IsUUID('4', { message: "L'identifiant de la classe doit être un UUID valide" })
  @IsNotEmpty({ message: 'La classe est obligatoire' })
  classRoomId: string;

  @IsUUID('4', { message: "L'identifiant de l'année scolaire doit être un UUID valide" })
  @IsNotEmpty({ message: "L'année scolaire est obligatoire" })
  academicYearId: string;

  @IsDateString({}, { message: 'La date doit être au format AAAA-MM-JJ' })
  date: string;

  @IsArray({ message: 'Les absences doivent être fournies sous forme de liste' })
  @ArrayMaxSize(600, { message: 'Trop d’absences envoyées en une seule fois' })
  @ValidateNested({ each: true })
  @Type(() => AbsenceEntryDto)
  absences: AbsenceEntryDto[];
}

export class UpdateAbsenceDto {
  @IsOptional()
  @IsBoolean({ message: 'Le caractère justifié doit être un booléen' })
  isJustified?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Le motif ne peut pas dépasser 255 caractères' })
  reason?: string;
}
