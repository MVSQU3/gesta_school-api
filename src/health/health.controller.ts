import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';

interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  timestamp: string;
  database: { status: 'up' | 'down'; latencyMs?: number; error?: string };
}

/**
 * Point de santé, volontairement public et non authentifié : c'est un load
 * balancer ou une supervision qui l'interroge, pas un utilisateur.
 *
 * Il vérifie réellement la base plutôt que de se contenter de répondre « je
 * suis démarré » : une API qui répond 200 alors que PostgreSQL est tombé fait
 * exactement le contraire de ce qu'on attend d'une sonde — elle maintient en
 * rotation une instance incapable de servir la moindre requête.
 *
 * Il ne divulgue ni version, ni nom de base, ni variable d'environnement.
 */
@Controller('api/v1/health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const startedAt = Date.now();
    let database: HealthReport['database'];

    try {
      await this.dataSource.query('SELECT 1');
      database = { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      database = {
        status: 'down',
        error: error instanceof Error ? error.message : 'erreur inconnue',
      };
      // 503 : la sonde doit pouvoir retirer l'instance de la rotation.
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database,
    };
  }
}
