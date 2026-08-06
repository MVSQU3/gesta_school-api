import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AuditAction } from '../entities/audit-log.entity';

export class QueryAuditDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AuditAction, { message: "Type d'opération inconnu" })
  action?: AuditAction;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsUUID('4', { message: "L'identifiant de l'objet doit être un UUID valide" })
  entityId?: string;

  @IsOptional()
  @IsUUID('4', {
    message: "L'identifiant de l'auteur doit être un UUID valide",
  })
  actorUserId?: string;

  /** Début de période, au format AAAA-MM-JJ. */
  @IsOptional()
  @IsDateString(
    {},
    { message: 'La date de début doit être au format AAAA-MM-JJ' },
  )
  from?: string;

  /** Fin de période incluse, au format AAAA-MM-JJ. */
  @IsOptional()
  @IsDateString(
    {},
    { message: 'La date de fin doit être au format AAAA-MM-JJ' },
  )
  to?: string;
}
