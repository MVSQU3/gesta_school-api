import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../decorators/current-user.decorator';
import { Role } from '../enums/role.enum';

/**
 * Résout l'établissement sur lequel porte la requête.
 *
 * Le personnel d'un établissement est toujours ramené à son propre `schoolId`,
 * quel que soit le paramètre reçu : un `schoolId` passé en query par un
 * directeur est ignoré. Seul le SUPER_ADMIN, qui n'est rattaché à aucune
 * école, peut désigner sa cible.
 */
export function resolveSchoolId(
  user: AuthUser,
  querySchoolId?: string,
): string {
  const schoolId = user.roles.includes(Role.SUPER_ADMIN)
    ? querySchoolId
    : user.schoolId;

  if (!schoolId) {
    throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
  }
  return schoolId;
}
