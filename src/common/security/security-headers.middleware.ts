import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * En-têtes de sécurité HTTP, équivalents à ce que pose `helmet` pour une API.
 *
 * Écrit à la main faute d'accès au registre npm au moment de la mise en place ;
 * le remplacer par `helmet()` dès que la dépendance peut être installée ne
 * changera rien au comportement observable.
 *
 * Le contenu servi est du JSON et des PDF, jamais du HTML : la politique la
 * plus stricte est donc sans risque ici — aucune page n'a besoin de charger un
 * script, une image ou une feuille de style depuis cette origine.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    // Interdit au navigateur de deviner un type MIME : un PDF renvoyé ne peut
    // pas être réinterprété comme du HTML exécutable.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Aucune page de l'API n'a vocation à être affichée dans une iframe.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

    // Ne pas divulguer l'URL de l'API — qui contient des identifiants de
    // dossier — aux sites tiers vers lesquels l'utilisateur naviguerait.
    res.setHeader('Referrer-Policy', 'no-referrer');

    // Aucune API navigateur sensible n'est utilisée côté serveur.
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=()',
    );

    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    // Masque la signature « Express », qui renseigne gratuitement un attaquant
    // sur la pile utilisée.
    res.removeHeader('X-Powered-By');

    // HSTS n'a de sens que sur une connexion déjà chiffrée : le poser en HTTP
    // clair est ignoré par les navigateurs, et le poser en développement
    // épinglerait `localhost` en HTTPS pour six mois.
    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=15552000; includeSubDomains',
      );
    }

    next();
  }
}
