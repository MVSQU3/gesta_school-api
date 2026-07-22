import {
  IsNotEmpty,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateStudentDto {
  @IsString({ message: 'Le prénom doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le prénom de l’élève est obligatoire' })
  @MaxLength(50, { message: 'Le prénom ne doit pas dépasser 50 caractères' })
  firstName: string;

  @IsString({ message: 'Le nom doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le nom de l’élève est obligatoire' })
  @MaxLength(50, { message: 'Le nom ne doit pas dépasser 50 caractères' })
  lastName: string;

  @IsString({ message: 'La date de naissance doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'La date de naissance est obligatoire' })
  @Matches(/^(0[1-9]|[12][0-9]|3[01])[-/](0[1-9]|1[0-2])[-/]\d{4}$/, {
    message:
      'La date de naissance doit être au format local JJ-MM-AAAA ou JJ/MM/AAAA (ex: 25-08-2012)',
  })
  birthDay: string;

  @IsString({ message: 'Le numéro de téléphone du parent doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le numéro de téléphone du parent est obligatoire' })
  @IsPhoneNumber('CI', {
    message: 'Le numéro de téléphone du parent doit être un numéro Ivoirien valide (+225)',
  })
  parentPhone: string;
}
