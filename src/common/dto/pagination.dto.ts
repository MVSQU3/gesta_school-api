import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Paramètres de pagination communs aux listes.
 * Les valeurs arrivent en query string : @Type(() => Number) les convertit
 * avant validation (le ValidationPipe global est en transform: true).
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Le numéro de page doit être un entier' })
  @Min(1, { message: 'Le numéro de page doit être supérieur ou égal à 1' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La taille de page doit être un entier' })
  @Min(1, { message: 'La taille de page doit être supérieure ou égale à 1' })
  @Max(200, { message: 'La taille de page ne peut pas dépasser 200' })
  limit?: number = 25;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  };
}
