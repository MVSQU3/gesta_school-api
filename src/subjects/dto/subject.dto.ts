import { PartialType } from '@nestjs/mapped-types';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSubjectDto {
  @IsString({ message: 'Le nom de la matière doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le nom de la matière est obligatoire' })
  @MaxLength(60, { message: 'Le nom ne peut pas dépasser 60 caractères' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(10, { message: "L'abréviation ne peut pas dépasser 10 caractères" })
  shortName?: string;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}

/** Rattachement d'une matière au programme d'une classe, avec son coefficient. */
export class AssignSubjectDto {
  @IsUUID('4', { message: "L'identifiant de la matière doit être un UUID valide" })
  @IsNotEmpty({ message: 'La matière est obligatoire' })
  subjectId: string;

  @IsNumber({}, { message: 'Le coefficient doit être un nombre' })
  @Min(0.5, { message: 'Le coefficient doit être au moins de 0,5' })
  @Max(20, { message: 'Le coefficient ne peut pas dépasser 20' })
  coefficient: number;
}

export class UpdateCoefficientDto {
  @IsNumber({}, { message: 'Le coefficient doit être un nombre' })
  @Min(0.5, { message: 'Le coefficient doit être au moins de 0,5' })
  @Max(20, { message: 'Le coefficient ne peut pas dépasser 20' })
  coefficient: number;
}
