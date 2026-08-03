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
   *
   * La fréquence horaire vient du cahier des charges, et elle a une raison
   * pratique : un dossier expiré n'apparaît dans « Les Oubliés » qu'une fois
   * basculé. À raison d'une ronde quotidienne, un parent qui se présentait le
   * matin pouvait attendre jusqu'à minuit avant que le secrétariat puisse
   * renouveler son dossier. Le décalage est désormais d'une heure au plus.
   *
   * L'encaissement ne dépend pas de cette ronde : la caisse vérifie elle-même
   * l'échéance à chaque versement et bascule le dossier au passage. La ronde
   * ne fait qu'alimenter l'écran de rattrapage.
   */
  @Cron(CronExpression.EVERY_HOUR)
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
      // En `debug` : la ronde passe désormais 24 fois par jour, et une ligne
      // par passage à vide noierait les journaux.
      this.logger.debug('Ronde terminée : Aucun dossier expiré détecté.');
    }
  }
}
