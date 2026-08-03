import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Nombre de tentatives autorisées dans la fenêtre. */
  limit: number;
  /** Largeur de la fenêtre glissante, en millisecondes. */
  windowMs: number;
  /**
   * Ce qui identifie l'appelant.
   *
   * `ip` suffit pour une route anonyme ordinaire. `ip+email` est réservé à la
   * connexion : dans un établissement, tout le monde partage la même adresse
   * publique, et compter par IP seule bloquerait le secrétariat entier dès
   * qu'un poste se trompe de mot de passe. Compter par couple (poste, compte)
   * arrête l'attaque sur un compte sans gêner les autres — et empêche aussi
   * qu'un tiers verrouille volontairement le compte du directeur depuis
   * l'extérieur, puisque sa propre adresse est comptée séparément.
   */
  by?: 'ip' | 'ip+email';
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

interface Window {
  /** Horodatages des tentatives encore dans la fenêtre. */
  hits: number[];
}

/**
 * Limitation du débit, en mémoire du processus.
 *
 * Volontairement sans dépendance : l'application tourne en un seul processus
 * sur un serveur d'établissement. Le compteur est donc remis à zéro par un
 * redémarrage et n'est pas partagé entre plusieurs instances — si le
 * déploiement passe un jour derrière plusieurs répliques ou un autoscaler, il
 * faudra le remplacer par `@nestjs/throttler` adossé à Redis. En l'état, il
 * couvre ce qu'il doit couvrir : le forçage de mot de passe depuis Internet.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();

  /** Dernier passage du nettoyage des fenêtres périmées. */
  private lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const key = this.buildKey(context, request, options);
    const now = Date.now();

    this.sweep(now);

    const window = this.windows.get(key) ?? { hits: [] };
    window.hits = window.hits.filter((at) => now - at < options.windowMs);

    if (window.hits.length >= options.limit) {
      const oldest = window.hits[0];
      const retryAfter = Math.ceil((options.windowMs - (now - oldest)) / 1000);

      // La tentative refusée n'est pas comptabilisée : sans quoi un client qui
      // insiste repousserait indéfiniment sa propre réouverture.
      this.windows.set(key, window);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Trop de tentatives. Réessayez dans ${retryAfter} seconde(s).`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    window.hits.push(now);
    this.windows.set(key, window);
    return true;
  }

  private buildKey(
    context: ExecutionContext,
    request: Request,
    options: RateLimitOptions,
  ): string {
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'inconnu';

    if (options.by === 'ip+email') {
      const body = request.body as { email?: unknown; slug?: unknown } | undefined;
      const email =
        typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      return `${route}|${ip}|${slug}|${email}`;
    }

    return `${route}|${ip}`;
  }

  /**
   * Purge des fenêtres inactives, au plus une fois par minute.
   *
   * Sans elle, la table grossirait d'une entrée par couple (adresse, compte)
   * rencontré depuis le démarrage : sur une API exposée, c'est une fuite de
   * mémoire lente mais certaine.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;

    for (const [key, window] of this.windows) {
      const lastHit = window.hits[window.hits.length - 1] ?? 0;
      if (now - lastHit > 3_600_000) this.windows.delete(key);
    }
  }
}
