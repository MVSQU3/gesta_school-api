import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {

  @IsOptional()
  @IsString()
  slug?: string;

  @IsEmail()
  email: string;

  /**
   * Aucun plancher de longueur ici, contrairement au choix d'un mot de passe.
   *
   * La connexion vérifie un mot de passe existant : le durcir refuserait les
   * comptes créés avant que le minimum ne passe à dix caractères, avec un
   * message de validation là où il faudrait « identifiants incorrects ».
   * Le plancher s'applique à la création et au changement, pas à la vérification.
   */
  @IsString()
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire' })
  password: string;
}
