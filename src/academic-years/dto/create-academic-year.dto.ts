import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAcademicYearDto {
  @IsString({
    message: 'Le libellé de l’année académique doit être une chaîne de caractères',
  })
  @IsNotEmpty({
    message: 'Le libellé de l’année académique est obligatoire (ex: 2026-2027)',
  })
  label: string;

  @IsBoolean({
    message: 'Le statut actif doit être un booléen (true ou false)',
  })
  @IsOptional()
  isActive?: boolean;
}
