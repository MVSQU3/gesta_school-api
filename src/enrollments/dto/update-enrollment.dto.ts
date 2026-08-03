import { IsOptional, IsUUID } from 'class-validator';

/**
 * Correction d'un dossier d'inscription.
 *
 * Seule la classe est modifiable. Tout le reste est volontairement figé :
 *  - l'élève, parce que changer d'élève reviendrait à créer un autre dossier
 *    en conservant sa référence comptable et ses versements ;
 *  - l'année scolaire, pour la même raison ;
 *  - la référence, le statut et le montant dû, qui se déduisent et ne se
 *    saisissent pas.
 *
 * Pour corriger l'identité de l'élève, c'est la fiche élève qu'on modifie
 * (PATCH /students/:id) : elle est partagée par tous ses dossiers.
 */
export class UpdateEnrollmentDto {
  @IsOptional()
  @IsUUID('4', { message: "L'identifiant de la classe doit être un UUID valide" })
  classRoomId?: string;
}
