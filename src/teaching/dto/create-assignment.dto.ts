import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateAssignmentDto {
  @IsUUID('4', { message: "L'identifiant de l'enseignant doit être un UUID valide" })
  @IsNotEmpty({ message: "L'enseignant est obligatoire" })
  teacherId: string;

  @IsUUID('4', { message: "L'identifiant de la classe doit être un UUID valide" })
  @IsNotEmpty({ message: 'La classe est obligatoire' })
  classRoomId: string;

  @IsUUID('4', { message: "L'identifiant de la matière doit être un UUID valide" })
  @IsNotEmpty({ message: 'La matière est obligatoire' })
  subjectId: string;

  @IsUUID('4', { message: "L'identifiant de l'année scolaire doit être un UUID valide" })
  @IsNotEmpty({ message: "L'année scolaire est obligatoire" })
  academicYearId: string;
}
