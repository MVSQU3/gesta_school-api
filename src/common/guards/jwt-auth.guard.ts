import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Seule route accessible tant qu'un mot de passe provisoire est en cours. */
const PASSWORD_CHANGE_ROUTE = '/auth/password';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Au-delà de la validation du jeton, refuse toute requête tant que
   * l'utilisateur n'a pas remplacé son mot de passe provisoire.
   *
   * Le contrôle est fait ici plutôt que côté interface : sans blocage serveur,
   * un mot de passe provisoire resterait utilisable indéfiniment par quiconque
   * contourne l'écran d'invite.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authorized = (await super.canActivate(context)) as boolean;
    if (!authorized) return false;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.mustChangePassword) {
      const path: string = request.path ?? request.url ?? '';
      const isChangingPassword =
        request.method === 'PATCH' && path.endsWith(PASSWORD_CHANGE_ROUTE);

      if (!isChangingPassword) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message:
            'Votre mot de passe est provisoire : vous devez en choisir un nouveau avant de continuer.',
          // Permet à l'interface de basculer sur l'écran de changement
          code: 'MUST_CHANGE_PASSWORD',
        });
      }
    }

    return true;
  }
}
