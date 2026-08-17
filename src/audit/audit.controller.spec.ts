import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { CsvService } from '../common/export/csv.service';
import { AuditAction } from './entities/audit-log.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController (journal d’audit)', () => {
  let controller: AuditController;
  let service: any;
  let csv: any;
  let res: any;

  const DIRECTOR = {
    id: 'dir-1',
    roles: [Role.DIRECTOR],
    schoolId: 'school-1',
    slug: 'CMB',
  } as AuthUser;
  const ADMIN = {
    id: 'admin-1',
    roles: [Role.SUPER_ADMIN],
    schoolId: null,
    slug: null,
  } as unknown as AuthUser;

  const entry = {
    createdAt: new Date(2026, 7, 3, 9, 5),
    actorEmail: 'dir@ecole.ci',
    action: AuditAction.CLASSROOM_UPDATED,
    entityType: 'classrooms',
    summary: 'Tarif porté de 100 000 à 120 000',
    changes: { tuitionFee: { before: 100000, after: 120000 } },
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ items: [] }),
      findAllForExport: jest.fn().mockResolvedValue([entry]),
      findForEntity: jest.fn().mockResolvedValue([]),
    };
    csv = new CsvService();
    jest.spyOn(csv, 'build');
    res = { setHeader: jest.fn(), send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        { provide: AuditService, useValue: service },
        { provide: CsvService, useValue: csv },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
  });

  describe('cloisonnement', () => {
    it('ignore le schoolId en query pour un directeur', async () => {
      await controller.findAll({} as any, DIRECTOR, 'school-voisine');

      // Un directeur ne voit que les opérations de son école.
      expect(service.findAll).toHaveBeenCalledWith('school-1', {});
    });

    it('laisse le SUPER_ADMIN désigner l’établissement', async () => {
      await controller.findAll({} as any, ADMIN, 'school-2');
      expect(service.findAll).toHaveBeenCalledWith('school-2', {});
    });

    it('refuse un SUPER_ADMIN sans établissement désigné', async () => {
      await expect(controller.findAll({} as any, ADMIN)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('applique la même règle à l’historique d’un objet', async () => {
      await controller.findForEntity(
        'classrooms',
        'class-1',
        DIRECTOR,
        'school-voisine',
      );
      expect(service.findForEntity.mock.calls[0]).toContain('school-1');
    });
  });

  describe('export', () => {
    it('produit un fichier téléchargeable horodaté', async () => {
      await controller.export({} as any, res, DIRECTOR);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('journal-audit-CMB-'),
      );
      expect(res.send).toHaveBeenCalled();
    });

    it('traduit les opérations en libellés lisibles', async () => {
      await controller.export({} as any, res, DIRECTOR);

      const operation = csv.build.mock.calls[0][0].find(
        (c: any) => c.header === 'Opération',
      );
      expect(operation.value(entry)).not.toBe(AuditAction.CLASSROOM_UPDATED);
    });

    it('se rabat sur le code de l’opération pour une action inconnue', async () => {
      await controller.export({} as any, res, DIRECTOR);

      const operation = csv.build.mock.calls[0][0].find(
        (c: any) => c.header === 'Opération',
      );
      // Une action ajoutée sans libellé ne doit pas produire une cellule vide.
      expect(operation.value({ action: 'ACTION_INEDITE' })).toBe(
        'ACTION_INEDITE',
      );
    });

    it('sérialise les valeurs modifiées', async () => {
      await controller.export({} as any, res, DIRECTOR);

      const changes = csv.build.mock.calls[0][0].find(
        (c: any) => c.header === 'Valeurs modifiées',
      );
      expect(changes.value(entry)).toContain('tuitionFee');
      expect(changes.value({ changes: null })).toBe('');
    });

    it('se rabat sur ECOLE quand l’utilisateur n’a pas de code établissement', async () => {
      await controller.export({} as any, res, ADMIN, 'school-2');

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('-ECOLE-'),
      );
    });
  });
});
