import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../enums/role.enum';

/**
 * Contenu du JWT, posé sur req.user par le JwtAuthGuard.
 */
export interface AuthUser {
  id: string;
  email: string;
  schoolId: string;
  slug: string;
  roles: Role[];
  /** Mot de passe provisoire en cours : toute action est bloquee sauf son changement. */
  mustChangePassword?: boolean;
}

/**
 * Extrait l'utilisateur courant depuis la requête.
 *
 * Usage :
 *   @Get('me')
 *   me(@CurrentUser() user: AuthUser) { ... }
 *
 * Ou pour un champ précis :
 *   @CurrentUser('id') userId: string
 *
 * Évite de manipuler `@Req() req` partout et de répéter `req.user`.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = request.user;
    if (!user) return null;
    return data ? user[data] : user;
  },
);
