import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { EnrollmentStatus } from '../entities/enrollment.entity';

export class QueryEnrollmentsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EnrollmentStatus, {
    message:
      'Le statut doit être PENDING_PAYMENT, PARTIALLY_PAID, ENROLLED ou EXPIRED',
  })
  status?: EnrollmentStatus;

  /** Recherche libre sur le nom, le prénom de l'élève ou la référence du dossier. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID('4', { message: "L'ID de l'année scolaire doit être un UUID valide" })
  academicYearId?: string;

  @IsOptional()
  @IsUUID('4', { message: "L'ID de la classe doit être un UUID valide" })
  classRoomId?: string;
}
