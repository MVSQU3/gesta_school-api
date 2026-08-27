import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { Gender } from '../../common/enums/gender.enum';

/**
 * Création d'un compte parent par le secrétariat.
 *
 * Pas de champ `password` — contrairement à `CreateUserDto`, qui sert aux
 * comptes du personnel. Le mot de passe est tiré par le serveur et rendu une
 * seule fois dans la réponse : un secrétariat qui choisirait lui-même les mots
 * de passe finirait par en réutiliser un pour toutes les familles.
 *
 * Pas de champ `roles` non plus : le rôle est PARENT, et rien d'autre. Le
 * laisser au client rouvrirait exactement la faille que `createStaff` ferme en
 * refusant SUPER_ADMIN.
 */
export class CreateParentDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @IsString()
  @Length(2, 50, { message: 'Le nom doit contenir entre 2 et 50 caractères' })
  lastName: string;

  @IsString()
  @Length(2, 50, { message: 'Le prénom doit contenir entre 2 et 50 caractères' })
  firstName: string;

  /**
   * Sexe du parent. Obligatoire : c'est lui qui désigne le père ou la mère
   * dans tous les écrans, et un compte sans sexe s'afficherait sans qualité.
   */
  @IsEnum(Gender, { message: 'Le sexe doit être MALE ou FEMALE' })
  gender: Gender;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Le téléphone ne peut pas dépasser 20 caractères' })
  phone?: string;

  /**
   * Enfants rattachés dès la création. Facultatif : le secrétariat peut créer
   * le compte puis rattacher, mais l'usage courant est de tout faire au
   * moment de l'inscription, formulaire en main.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Identifiant élève invalide' })
  @ArrayMaxSize(20, {
    message: 'Pas plus de 20 enfants rattachés en une seule fois',
  })
  studentIds?: string[];
}
