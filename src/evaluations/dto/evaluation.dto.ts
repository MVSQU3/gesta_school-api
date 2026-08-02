import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EvaluationType } from '../entities/evaluation.entity';

export class CreateEvaluationDto {
  @IsUUID('4', { message: "L'identifiant de la classe doit être un UUID valide" })
  @IsNotEmpty({ message: 'La classe est obligatoire' })
  classRoomId: string;

  @IsUUID('4', { message: "L'identifiant de la matière doit être un UUID valide" })
  @IsNotEmpty({ message: 'La matière est obligatoire' })
  subjectId: string;

  @IsUUID('4', { message: "L'identifiant de la période doit être un UUID valide" })
  @IsNotEmpty({ message: 'La période de notation est obligatoire' })
  gradingPeriodId: string;

  @IsEnum(EvaluationType, {
    message: "Le type doit être DEVOIR ou INTERROGATION",
  })
  type: EvaluationType;

  @IsString()
  @IsNotEmpty({ message: "L'intitulé de l'évaluation est obligatoire" })
  @MaxLength(100, { message: "L'intitulé ne peut pas dépasser 100 caractères" })
  title: string;

  @IsDateString({}, { message: 'La date doit être au format AAAA-MM-JJ' })
  date: string;

  /**
   * Barème : 20 pour un devoir, 10 ou 20 pour une interrogation.
   * La cohérence type/barème est vérifiée côté service.
   */
  @IsOptional()
  @IsIn([10, 20], { message: 'Le barème doit être sur 10 ou sur 20' })
  maxScore?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Le poids doit être un nombre' })
  @Min(0.5, { message: 'Le poids doit être au moins de 0,5' })
  @Max(10, { message: 'Le poids ne peut pas dépasser 10' })
  weight?: number;
}

export class UpdateEvaluationDto extends PartialType(CreateEvaluationDto) {}

/** Note d'un élève, dans le barème de l'évaluation. */
export class GradeEntryDto {
  @IsUUID('4', { message: "L'identifiant de l'inscription doit être un UUID valide" })
  enrollmentId: string;

  @IsOptional()
  @IsNumber({}, { message: 'La note doit être un nombre' })
  @Min(0, { message: 'Une note ne peut pas être négative' })
  score?: number | null;

  @IsOptional()
  @IsBoolean({ message: "L'absence doit être un booléen" })
  isAbsent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'L’appréciation ne peut pas dépasser 255 caractères' })
  comment?: string;
}

/**
 * Saisie d'une feuille de notes complète. L'enseignant enregistre toute sa
 * classe en une fois plutôt qu'élève par élève.
 */
export class SaveGradesDto {
  @IsArray({ message: 'Les notes doivent être fournies sous forme de liste' })
  @ArrayMaxSize(300, { message: 'Trop de notes envoyées en une seule fois' })
  @ValidateNested({ each: true })
  @Type(() => GradeEntryDto)
  grades: GradeEntryDto[];
}
