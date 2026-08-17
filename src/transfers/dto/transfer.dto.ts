import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Recherche d'un élève dans les autres établissements.
 *
 * Les trois critères sont obligatoires et recoupés exactement : c'est ce qui
 * sépare « je retrouve l'élève que le parent m'a présenté » de « je parcours
 * les élèves des écoles voisines ». Le directeur qui fait la demande a la
 * fiche de l'enfant sous les yeux ; exiger la date de naissance ne lui coûte
 * rien et ferme l'exploration à l'aveugle.
 */
export class SearchStudentDto {
  @IsString()
  @IsNotEmpty({ message: 'Le nom est obligatoire' })
  @MinLength(2, { message: 'Le nom doit comporter au moins 2 caractères' })
  @MaxLength(50)
  lastName: string;

  @IsString()
  @IsNotEmpty({ message: 'Le prénom est obligatoire' })
  @MinLength(2, { message: 'Le prénom doit comporter au moins 2 caractères' })
  @MaxLength(50)
  firstName: string;

  /** Date de naissance au format JJ-MM-AAAA, comme à la saisie. */
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'La date de naissance doit être au format JJ-MM-AAAA',
  })
  birthDay: string;
}

export class CreateTransferRequestDto {
  @IsUUID('4', { message: "L'identifiant de l'élève doit être un UUID valide" })
  studentId: string;

  @IsUUID('4', { message: "L'identifiant de l'école doit être un UUID valide" })
  holdingSchoolId: string;

  @IsString()
  @IsNotEmpty({ message: 'Le motif de la demande est obligatoire' })
  @MinLength(10, {
    message: 'Le motif doit être explicite (10 caractères au minimum)',
  })
  @MaxLength(500)
  reason: string;
}

export class ApproveTransferDto {
  /**
   * Durée de l'accès. 30 jours par défaut : le temps d'instruire une
   * inscription, sans devenir un accès permanent qu'on oublie de couper.
   */
  @IsOptional()
  @IsInt({ message: 'La durée doit être un nombre de jours' })
  @Min(1, { message: "L'accès doit durer au moins 1 jour" })
  @Max(180, { message: "L'accès ne peut pas dépasser 180 jours" })
  durationDays?: number;
}

export class RejectTransferDto {
  @IsString()
  @IsNotEmpty({ message: 'Le motif du refus est obligatoire' })
  @MaxLength(500)
  reason: string;
}
