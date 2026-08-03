import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

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

  if (origins.length > 0) return origins;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CORS_ORIGINS est obligatoire en production : indiquez l’URL de ' +
        "l'interface web, par exemple CORS_ORIGINS=https://ecole.exemple.ci",
    );
  }

  return true;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

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
