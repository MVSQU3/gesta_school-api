import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsUUID,
} from 'class-validator';

/**
 * Réinscription en masse : ouvre un dossier pour toute une liste d'élèves,
 * dans une même classe et une même année scolaire.
 *
 * C'est le geste de la rentrée — faire monter une classe entière d'un niveau —
 * mais l'API ne raisonne pas en « promotion » : elle reçoit une liste d'élèves
 * et une classe d'accueil. Le secrétariat garde ainsi la main sur qui monte,
 * qui redouble et qui part, sans que le serveur ait à deviner la progression
 * des niveaux d'un établissement qu'il ne connaît pas.
 */
export class BulkEnrollDto {
  @IsUUID('4', { message: "L'identifiant de la classe doit être un UUID valide" })
  classRoomId: string;

  @IsUUID('4', {
    message: "L'identifiant de l'année scolaire doit être un UUID valide",
  })
  academicYearId: string;

  @IsArray({ message: 'La liste des élèves est obligatoire' })
  @ArrayNotEmpty({ message: 'Sélectionnez au moins un élève' })
  @ArrayMaxSize(200, {
    message:
      'Pas plus de 200 élèves à la fois : traitez la réinscription classe par classe',
  })
  @IsUUID('4', {
    each: true,
    message: "Chaque identifiant d'élève doit être un UUID valide",
  })
  studentIds: string[];
}
