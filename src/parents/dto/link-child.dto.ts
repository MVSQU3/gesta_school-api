import { IsUUID } from 'class-validator';

/**
 * Rattachement d'un enfant à un compte parent existant.
 *
 * Rien d'autre que l'élève : la qualité du parent — père ou mère — est portée
 * par le compte lui-même, et non par chaque rattachement. Une même personne ne
 * change pas de sexe d'un enfant à l'autre.
 */
export class LinkChildDto {
  @IsUUID('4', { message: 'Identifiant élève invalide' })
  studentId: string;
}
