import { IsEnum } from 'class-validator';
import { PeriodSystem } from '../entities/school.entity';

/**
 * Découpage de l'année scolaire, réglé par la direction pour son propre
 * établissement.
 *
 * DTO séparé de `UpdateSchoolDto` : celui-ci porte le nom, le slug et
 * l'adresse, réservés au super-administrateur. Un directeur ne doit pouvoir
 * toucher qu'à ce seul champ, et un DTO restreint l'y contraint mieux qu'un
 * contrôle dans le service.
 */
export class UpdatePeriodSystemDto {
  @IsEnum(PeriodSystem, {
    message: 'Le découpage doit être TRIMESTER (3 trimestres) ou SEMESTER (2 semestres)',
  })
  periodSystem: PeriodSystem;
}
