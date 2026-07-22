import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CreateStudentDto } from '../../students/dto/create-student.dto';

export class CreateEnrollmentDto {
  @IsUUID('4', { message: 'L’ID de l’établissement doit être un identifiant UUID valide' })
  @IsNotEmpty({ message: 'La sélection de l’établissement est obligatoire' })
  schoolId: string;

  @IsOptional()
  @IsUUID('4', { message: 'L’ID de l’élève doit être un identifiant UUID valide' })
  studentId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateStudentDto)
  studentData?: CreateStudentDto;

  @IsUUID('4', { message: 'L’ID de la classe doit être un identifiant UUID valide' })
  @IsNotEmpty({ message: 'La sélection de la classe est obligatoire' })
  classRoomId: string;

  @IsUUID('4', { message: 'L’ID de l’année académique doit être un identifiant UUID valide' })
  @IsNotEmpty({ message: 'La sélection de l’année académique est obligatoire' })
  academicYearId: string;
}
