import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ClassRoomLevel } from '../entities/classroom.entity';

export class CreateClassRoomDto {
  @IsString({ message: 'Le nom de la classe doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le nom de la classe est obligatoire (ex: 6ème A)' })
  name: string;

  @IsEnum(ClassRoomLevel, {
    message: 'Le niveau doit être soit COLLEGE soit LYCEE',
  })
  @IsNotEmpty({
    message: 'Le niveau de la classe (COLLEGE ou LYCEE) est obligatoire',
  })
  level: ClassRoomLevel;

  @IsOptional()
  @IsNumber({}, { message: 'Les frais de scolarité doivent être un nombre' })
  @Min(0, { message: 'Les frais de scolarité ne peuvent pas être négatifs' })
  tuitionFee?: number;
}
