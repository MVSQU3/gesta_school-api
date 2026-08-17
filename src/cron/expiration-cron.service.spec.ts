import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import { ExpirationCronService } from './expiration-cron.service';

/**
 * La ronde des jetons 72h alimente l'écran « Les Oubliés ». Elle ne doit
 * toucher que les dossiers réellement échus et jamais ceux déjà réglés.
 */
describe('ExpirationCronService (ronde des jetons 72h)', () => {
  let service: ExpirationCronService;
  let enrollmentRepo: any;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    enrollmentRepo = { update: jest.fn().mockResolvedValue({ affected: 0 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpirationCronService,
        { provide: getRepositoryToken(Enrollment), useValue: enrollmentRepo },
      ],
    }).compile();

    service = module.get<ExpirationCronService>(ExpirationCronService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('ne bascule que les dossiers sans aucun versement', async () => {
    await service.handleExpirationScan();

    // Un dossier partiellement réglé a sécurisé sa place : il ne doit jamais
    // expirer, même passé le délai.
    const [criteria] = enrollmentRepo.update.mock.calls[0];
    expect(criteria.status).toBe(EnrollmentStatus.PENDING_PAYMENT);
  });

  it('ne bascule que les échéances déjà passées', async () => {
    await service.handleExpirationScan();

    const [criteria] = enrollmentRepo.update.mock.calls[0];
    expect(criteria.expiresAt).toEqual(LessThan(expect.any(Date)));
  });

  it('passe les dossiers échus en EXPIRED', async () => {
    await service.handleExpirationScan();

    const [, update] = enrollmentRepo.update.mock.calls[0];
    expect(update).toEqual({ status: EnrollmentStatus.EXPIRED });
  });

  it('signale en avertissement les dossiers basculés', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    enrollmentRepo.update.mockResolvedValue({ affected: 3 });

    await service.handleExpirationScan();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('3 dossier(s)'));
  });

  it('reste discret quand la ronde ne trouve rien', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const debug = jest.spyOn(Logger.prototype, 'debug');

    await service.handleExpirationScan();

    // La ronde passe 24 fois par jour : une ligne d'avertissement par passage
    // à vide noierait les journaux.
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalled();
  });

  it('tolère un pilote qui ne renvoie pas le nombre de lignes touchées', async () => {
    enrollmentRepo.update.mockResolvedValue({});

    await expect(service.handleExpirationScan()).resolves.toBeUndefined();
  });
});
