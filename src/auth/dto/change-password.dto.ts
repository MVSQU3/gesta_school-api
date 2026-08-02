import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString({ message: 'Le mot de passe actuel doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le mot de passe actuel est obligatoire' })
  currentPassword: string;

  @IsString({ message: 'Le nouveau mot de passe doit être une chaîne de caractères' })
  @MinLength(6, {
    message: 'Le nouveau mot de passe doit comporter au moins 6 caractères',
  })
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
  @MinLength(6, {
    message: 'Le nouveau mot de passe doit comporter au moins 6 caractères',
  })
  newPassword?: string;
}
