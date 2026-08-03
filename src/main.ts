import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
// `export =` en CommonJS : la forme import-equals est la seule correcte ici.
// Un import par défaut compilerait — `allowSyntheticDefaultImports` est actif —
// mais échouerait à l'exécution, `esModuleInterop` étant désactivé.
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

/**
 * Longueur minimale du secret de signature des jetons.
 *
 * En deçà, la clé devient devinable par force brute hors ligne : quiconque
 * possède un jeton peut alors en forger un autre, avec le rôle de son choix.
 */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Vérifie le secret JWT au démarrage plutôt qu'à la première signature.
 *
 * Sans ce contrôle, une variable absente ou vide laissait l'application
 * démarrer normalement : les jetons étaient alors signés avec une chaîne vide,
 * et n'importe qui pouvait en fabriquer. Mieux vaut refuser de démarrer.
 */
function assertJwtSecret(): void {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'JWT_SECRET est absent ou vide. Générez-en un avec : openssl rand -base64 48',
    );
  }

  if (secret.trim().length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET est trop court (${secret.trim().length} caractères, ${MIN_JWT_SECRET_LENGTH} minimum). ` +
      'Générez-en un avec : openssl rand -base64 48',
    );
  }
}

/**
 * Origines autorisées à appeler l'API, lues dans CORS_ORIGINS (liste séparée
 * par des virgules).
 *
 * Hors production, la variable peut rester vide : toutes les origines sont
 * acceptées, ce qui évite d'avoir à la renseigner pour un `npm run start:dev`.
 * En production, une valeur vide est une erreur de configuration et non une
 * autorisation implicite : l'API refuse de démarrer plutôt que de s'ouvrir à
 * n'importe quel site, qui pourrait alors l'appeler avec le jeton de
 * l'utilisateur connecté.
 */
function resolveCorsOrigins(): string[] | boolean {
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length > 0) return origins

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CORS_ORIGINS est obligatoire en production : indiquez l’URL de ' +
      "l'interface web, par exemple CORS_ORIGINS=https://ecole.exemple.ci",
    );
  }

  return true;
}

async function bootstrap() {
  // Avant toute chose : une configuration de sécurité invalide doit empêcher
  // le démarrage, pas être découverte à la première connexion d'un utilisateur.
  assertJwtSecret();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  /**
   * En-têtes de sécurité HTTP — source unique.
   *
   * Le contenu servi est du JSON et des PDF, jamais du HTML : la politique la
   * plus stricte est donc sans coût ici, aucune page n'ayant besoin de charger
   * un script ou une feuille de style depuis cette origine.
   *
   * Deux écarts assumés par rapport aux valeurs par défaut :
   *  - HSTS uniquement en production. En HTTP clair il est ignoré, et l'activer
   *    en développement épinglerait `localhost` en HTTPS pour des mois.
   *  - `Cross-Origin-Resource-Policy: same-site` plutôt que `same-origin` :
   *    l'interface web est servie depuis un autre port ou sous-domaine que
   *    l'API, ce qui reste le même « site ». Les téléchargements de reçus et
   *    de bulletins passent, sans ouvrir la ressource à tout l'Internet.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 15552000, includeSubDomains: true }
          : false,
    }),
  );

  // Non couvert par helmet : aucune API navigateur sensible n'est utilisée.
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=()',
    );
    next();
  });

  // Ne pas annoncer la pile technique : c'est une indication gratuite offerte
  // à qui cherche une vulnérabilité connue d'Express.
  app.disable('x-powered-by');

  // Lecture du cookie de session, où réside le jeton d'authentification.
  app.use(cookieParser());

  // Derrière un reverse proxy (nginx, Caddy), l'adresse vue par Express est
  // celle du proxy. Sans cette option, la limitation des tentatives de
  // connexion compterait tout le trafic sur une seule et même adresse.
  app.set('trust proxy', process.env.TRUST_PROXY === 'true');

  // Activation de la validation automatique via les DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const origins = resolveCorsOrigins();
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    /**
     * Indispensable au cookie de session : sans cela le navigateur refuse de
     * l'émettre vers une autre origine, et l'interface serait déconnectée à
     * chaque requête.
     *
     * `Access-Control-Allow-Origin` ne peut alors plus valoir `*` — la liste
     * blanche CORS_ORIGINS (ou le reflet de l'origine en développement) le
     * garantit déjà.
     */
    credentials: true,
    maxAge: 86400,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(
    `API démarrée sur le port ${port} (${process.env.NODE_ENV ?? 'development'})`,
  );
  logger.log(
    Array.isArray(origins)
      ? `CORS : ${origins.join(', ')}`
      : 'CORS : toutes origines autorisées (développement)',
  );
}

bootstrap().catch((error) => {
  new Logger('Bootstrap').error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
