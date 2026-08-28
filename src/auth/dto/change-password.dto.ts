import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT,
} from '../../common/security/password-policy';

export class ChangePasswordDto {
  @IsString({ message: 'Le mot de passe actuel doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le mot de passe actuel est obligatoire' })
  currentPassword: string;

  @IsString({ message: 'Le nouveau mot de passe doit être une chaîne de caractères' })
  @MinLength(MIN_PASSWORD_LENGTH, { message: PASSWORD_TOO_SHORT })
  newPassword: string;
}

/**
 * Réinitialisation par la direction : le mot de passe actuel n'est pas
 * demandé, puisque c'est précisément parce que l'employé l'a perdu que
 * l'opération existe.
 */
export class ResetPasswordDto {
  /**
   * Optionnel : sans valeur, un mot de passe provisoire est généré et renvoyé
   * une seule fois dans la réponse.
   */
  @IsOptional()
  @IsString({ message: 'Le nouveau mot de passe doit être une chaîne de caractères' })
  @MinLength(MIN_PASSWORD_LENGTH, { message: PASSWORD_TOO_SHORT })
  newPassword?: string;
}
