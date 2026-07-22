import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSchoolDto {
  @IsString({ message: 'Le nom de l’établissement doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le nom de l’établissement est obligatoire' })
  @MaxLength(100, { message: 'Le nom ne doit pas dépasser 100 caractères' })
  name: string; // Ex: "Collège Moderne de Bouaké"

  @IsString({ message: 'Le code de l’établissement doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le code court de l’établissement est obligatoire (ex: CMB)' })
  @MaxLength(10, { message: 'Le code ne doit pas dépasser 10 caractères' })
  slug: string; // Ex: "CMB"

  @IsString({ message: 'L’adresse doit être une chaîne de caractères' })
  @IsOptional()
  address?: string;

  @IsString({ message: 'Le téléphone doit être une chaîne de caractères' })
  @IsOptional()
  phone?: string;
}
