import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Enrollment, EnrollmentStatus } from '../enrollments/entities/enrollment.entity';

@Injectable()
export class ExpirationCronService {
  private readonly logger = new Logger(ExpirationCronService.name);

  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
  ) {}

  /**
   * Tâche d'arrière-plan exécutée toutes les heures.
   * Scanne les inscriptions en attente de paiement (PENDING_PAYMENT)
   * dont la date d'expiration est inférieure à maintenant (expiresAt < NOW()),
   * et bascule leur statut vers EXPIRED.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleExpirationScan() {
    this.logger.log('Démarrage de la ronde automatique des jetons expirés (72h)...');

    const now = new Date();
    const result = await this.enrollmentRepository.update(
      {
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt: LessThan(now),
      },
      {
        status: EnrollmentStatus.EXPIRED,
      },
    );

    const affectedCount = result.affected ?? 0;
    if (affectedCount > 0) {
      this.logger.warn(
        `Ronde terminée : ${affectedCount} dossier(s) expiré(s) basculé(s) vers l'état EXPIRED (onglet 'Les Oubliés').`,
      );
    } else {
      this.logger.log('Ronde terminée : Aucun dossier expiré détecté.');
    }
  }
}
