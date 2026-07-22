import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
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
}
