import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import { UsersService } from '../../users/users.service';
import { SESSION_COOKIE } from '../auth-cookie';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: Role[];
  slug: string;
  schoolId: string | null;
  /** Date d'émission du jeton, en secondes — posée automatiquement par jsonwebtoken. */
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UsersService) {
    super({
      /**
       * Le cookie de session est lu en priorité : c'est le mode d'usage de
       * l'interface web, où le jeton reste hors de portée du JavaScript.
       *
       * L'en-tête `Authorization` reste accepté en second, pour les clients
       * non-navigateur — scripts d'intégration, sondes, outils de test. Il
       * n'affaiblit rien : il n'y a plus de jeton à dérober côté navigateur.
       */
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request & { cookies?: Record<string, string> }) =>
          req?.cookies?.[SESSION_COOKIE] ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  /**
   * Le compte est revérifié en base à chaque requête.
   *
   * Sans cette lecture, le jeton restait valable jusqu'à son expiration (24 h)
   * quoi qu'il advienne du compte entre-temps : un employé désactivé conservait
   * son accès, et un mot de passe changé ne fermait pas les sessions ouvertes
   * ailleurs. C'est une requête supplémentaire par appel, assumée — la
   * révocation immédiate prime ici sur l'économie d'un accès base.
   */
  async validate(payload: JwtPayload) {
    const user = await this.usersService.findByIdForAuth(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Compte introuvable.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        "Ce compte a été désactivé. Rapprochez-vous de la direction de l'établissement.",
      );
    }

    // Un jeton antérieur au dernier changement de mot de passe est révoqué.
    if (user.passwordChangedAt && payload.iat) {
      if (payload.iat * 1000 < user.passwordChangedAt.getTime()) {
        throw new UnauthorizedException(
          'Votre mot de passe a été modifié. Veuillez vous reconnecter.',
        );
      }
    }

    // Rôles et école sont relus en base plutôt que repris du jeton : un
    // changement de rôle prend ainsi effet immédiatement.
    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
      slug: user.slug,
      schoolId: user.schoolId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
