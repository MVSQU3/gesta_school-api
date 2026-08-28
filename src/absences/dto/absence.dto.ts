import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AbsenceStatus } from '../entities/absence.entity';

/** Ce qui est constaté pour un élève sur la séance appelée. */
export class AbsenceEntryDto {
  @IsUUID('4', { message: "L'identifiant de l'inscription doit être un UUID valide" })
  enrollmentId: string;

  @IsEnum(AbsenceStatus, {
    message: 'Le statut doit être ABSENT ou LATE',
  })
  status: AbsenceStatus;

  @IsOptional()
  @IsBoolean({ message: 'Le caractère justifié doit être un booléen' })
  isJustified?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Le motif ne peut pas dépasser 255 caractères' })
  reason?: string;
}

/**
 * Appel d'une séance : le relevé complet des écarts pour un cours donné.
 *
 * Le professeur envoie la liste des absents et des retardataires ; ceux qui
 * n'y figurent pas sont présents. Un élève retiré de la liste voit son
 * absence effacée — c'est un relevé, pas une suite d'ajouts.
 *
 * `scheduleEntryId` désigne la séance de l'emploi du temps, ce qui fixe à la
 * fois la classe, la matière, l'enseignant et le créneau horaire. La date
 * reste demandée : un même créneau revient chaque semaine.
 */
export class RecordAbsencesDto {
  @IsUUID('4', { message: "L'identifiant de la séance doit être un UUID valide" })
  @IsNotEmpty({ message: 'La séance de cours est obligatoire' })
  scheduleEntryId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La date doit être au format AAAA-MM-JJ',
  })
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AbsenceEntryDto)
  entries: AbsenceEntryDto[];
}

/** Correction d'une ligne d'assiduité, par la direction ou l'enseignant. */
export class UpdateAbsenceDto {
  @IsOptional()
  @IsEnum(AbsenceStatus, { message: 'Le statut doit être ABSENT ou LATE' })
  status?: AbsenceStatus;

  @IsOptional()
  @IsBoolean({ message: 'Le caractère justifié doit être un booléen' })
  isJustified?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Le motif ne peut pas dépasser 255 caractères' })
  reason?: string;
}
