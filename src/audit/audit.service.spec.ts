import { ForbiddenException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuditAction, AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';

describe('AuditService (journal d’audit)', () => {
  let service: AuditService;
  let auditRepo: any;
  let queryBuilder: any;

  const ACTOR = {
    id: 'user-1',
    email: 'dir@ecole.ci',
    schoolId: 'school-1',
    roles: [Role.DIRECTOR],
  } as AuthUser;

  const entry = (overrides: any = {}) => ({
    action: AuditAction.CLASSROOM_UPDATED,
    entityType: 'classrooms',
    entityId: 'class-1',
    schoolId: 'school-1',
    summary: 'Tarif modifié',
    ...overrides,
  });

  beforeEach(async () => {
    queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    auditRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((l) => Promise.resolve(l)),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe('record', () => {
    it('consigne l’auteur de l’opération', async () => {
      await service.record(entry(), ACTOR);

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          actorEmail: 'dir@ecole.ci',
        }),
      );
    });

    it('accepte une opération sans auteur identifié', async () => {
      await service.record(entry());

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: null, actorEmail: null }),
      );
    });

    it('se rabat sur l’école de l’auteur quand aucune n’est précisée', async () => {
      await service.record(entry({ schoolId: undefined }), ACTOR);

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ schoolId: 'school-1' }),
      );
    });

    it('tronque un résumé trop long pour la colonne', async () => {
      await service.record(entry({ summary: 'x'.repeat(400) }));

      const created = auditRepo.create.mock.calls[0][0];
      expect(created.summary).toHaveLength(255);
    });

    it('n’interrompt pas l’opération métier si l’écriture échoue', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      auditRepo.save.mockRejectedValue(new Error('base indisponible'));

      // Refuser une correction de tarif parce que la trace n'a pas pu être
      // écrite serait un remède pire que le mal.
      await expect(service.record(entry())).resolves.toBeUndefined();
    });

    it('signale l’incident dans les logs du serveur', async () => {
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      auditRepo.save.mockRejectedValue(new Error('base indisponible'));

      await service.record(entry());
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('base indisponible'),
      );
    });
  });

  describe('diff', () => {
    it('ne retient que les champs réellement modifiés', () => {
      const changes = service.diff(
        { nom: 'Kone', tarif: 100000 },
        { nom: 'Kone', tarif: 120000 },
      );

      expect(changes).toEqual({ tarif: { before: 100000, after: 120000 } });
    });

    it('renvoie null quand rien n’a changé', () => {
      // Sans ce filtre, enregistrer un formulaire sans rien toucher produirait
      // une ligne listant tous les champs.
      expect(service.diff({ nom: 'Kone' }, { nom: 'Kone' })).toBeNull();
    });

    it('ignore un champ absent du nouvel état', () => {
      expect(
        service.diff({ nom: 'Kone' }, { nom: 'Kone', tarif: undefined }),
      ).toBeNull();
    });

    it('assimile undefined et null à l’état antérieur', () => {
      expect(service.diff({ motif: undefined }, { motif: null })).toBeNull();
    });

    it('compare les tableaux par valeur et non par référence', () => {
      expect(
        service.diff({ roles: ['SECRETARY'] }, { roles: ['SECRETARY'] }),
      ).toBeNull();

      expect(
        service.diff({ roles: ['SECRETARY'] }, { roles: ['ACCOUNTANT'] }),
      ).toEqual({
        roles: { before: ['SECRETARY'], after: ['ACCOUNTANT'] },
      });
    });

    it('détecte l’apparition d’une valeur là où il n’y en avait pas', () => {
      expect(service.diff({}, { motif: 'Erreur de saisie' })).toEqual({
        motif: { before: null, after: 'Erreur de saisie' },
      });
    });
  });

  describe('consultation', () => {
    it('cloisonne le journal par établissement', async () => {
      await service.findAll('school-1', {} as any);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'audit.schoolId = :schoolId',
        { schoolId: 'school-1' },
      );
    });

    it('exige un établissement résolu', async () => {
      await expect(service.findAll('', {} as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('classe du plus récent au plus ancien', async () => {
      await service.findAll('school-1', {} as any);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'audit.createdAt',
        'DESC',
      );
    });

    it('n’applique aucun filtre superflu', async () => {
      await service.findAll('school-1', {} as any);
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('applique les filtres fournis', async () => {
      await service.findAll('school-1', {
        action: AuditAction.CLASSROOM_UPDATED,
        entityType: 'classrooms',
        entityId: 'class-1',
        actorUserId: 'user-1',
      } as any);

      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(4);
    });

    it('pagine à partir de la première page par défaut', async () => {
      await service.findAll('school-1', {} as any);

      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(50);
    });

    it('calcule le décalage de la page demandée', async () => {
      await service.findAll('school-1', { page: 3, limit: 20 } as any);
      expect(queryBuilder.skip).toHaveBeenCalledWith(40);
    });

    it('inclut la journée entière de la date de fin', async () => {
      await service.findAll('school-1', {
        from: '2026-08-01',
        to: '2026-08-03',
      } as any);

      // Borner à minuit exclurait toutes les opérations du dernier jour.
      const [, params] = queryBuilder.andWhere.mock.calls[0];
      expect(params.start.getHours()).toBe(0);
      expect(params.end.getHours()).toBe(23);
      expect(params.end.getMinutes()).toBe(59);
    });

    it('relève une borne large quand seule une des deux dates est fournie', async () => {
      await service.findAll('school-1', { to: '2026-08-03' } as any);

      const [, params] = queryBuilder.andWhere.mock.calls[0];
      expect(params.start.getFullYear()).toBe(2000);
    });
  });

  describe('export', () => {
    it('remonte largement plus de lignes que l’écran', async () => {
      await service.findAllForExport('school-1', { limit: 50 } as any);

      // L'export doit contenir tout le résultat filtré, pas la page affichée.
      expect(queryBuilder.take).toHaveBeenCalledWith(5000);
    });
  });
});
