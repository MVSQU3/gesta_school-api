import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { CsvService } from '../common/export/csv.service';
import { EnrollmentStatus } from './entities/enrollment.entity';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsController (dossiers d’inscription)', () => {
  let controller: EnrollmentsController;
  let service: any;
  let csv: any;
  let res: any;

  const SECRETARY = {
    id: 'sec-1',
    roles: [Role.SECRETARY],
    schoolId: 'school-1',
    slug: 'CMB',
  } as AuthUser;
  const ADMIN = {
    id: 'admin-1',
    roles: [Role.SUPER_ADMIN],
    schoolId: null,
    slug: null,
  } as unknown as AuthUser;

  const dossier = {
    reference: 'INS-CMB-26-0001',
    status: EnrollmentStatus.PARTIALLY_PAID,
    createdAt: new Date(2026, 7, 3),
    expiresAt: new Date(2026, 7, 6),
    student: {
      lastName: 'Kone',
      firstName: 'Ama',
      birthDay: '2011-03-05',
      parentPhone: '+2250700000001',
    },
    classRoom: { name: '6ème A' },
    academicYear: { label: '2026-2027' },
    balanceInfo: { totalDue: 100000, amountPaid: 40000, balance: 60000 },
  };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue(dossier),
      bulkEnroll: jest.fn().mockResolvedValue({ created: 2, skipped: [] }),
      findAll: jest.fn().mockResolvedValue({ items: [] }),
      findAllForExport: jest.fn().mockResolvedValue([dossier]),
      findExpired: jest.fn().mockResolvedValue([]),
      findAllExpired: jest.fn().mockResolvedValue([]),
      findByReference: jest.fn().mockResolvedValue(dossier),
      renew: jest.fn().mockResolvedValue(dossier),
      validate: jest.fn().mockResolvedValue(dossier),
      update: jest.fn().mockResolvedValue(dossier),
      remove: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    csv = new CsvService();
    jest.spyOn(csv, 'build');
    res = { setHeader: jest.fn(), send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollmentsController],
      providers: [
        { provide: EnrollmentsService, useValue: service },
        { provide: CsvService, useValue: csv },
      ],
    }).compile();

    controller = module.get<EnrollmentsController>(EnrollmentsController);
  });

  describe('cloisonnement', () => {
    it('impose l’école de la secrétaire au dossier créé', async () => {
      const dto: any = { classRoomId: 'class-1', schoolId: 'school-pirate' };
      await controller.create(dto, SECRETARY, 'school-voisine');

      // Le schoolId du corps de requête comme celui de la query sont écrasés
      // par celui du jeton.
      expect(dto.schoolId).toBe('school-1');
    });

    it('laisse le SUPER_ADMIN désigner l’établissement', async () => {
      const dto: any = {};
      await controller.create(dto, ADMIN, 'school-2');
      expect(dto.schoolId).toBe('school-2');
    });

    it('refuse un SUPER_ADMIN sans établissement désigné', async () => {
      await expect(controller.create({} as any, ADMIN)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each([
      ['findAll', () => controller.findAll({} as any, SECRETARY, 'x'), 'findAll'],
      ['renew', () => controller.renew('e1', SECRETARY, 'x'), 'renew'],
      ['validate', () => controller.validate('e1', SECRETARY, 'x'), 'validate'],
      ['remove', () => controller.remove('e1', SECRETARY, 'x'), 'remove'],
    ])('ignore le schoolId en query sur %s', async (_label, call, method) => {
      await call();

      const args = service[method].mock.calls[0];
      expect(args).toContain('school-1');
      expect(args).not.toContain('x');
    });

    it('applique la même règle à la recherche par référence', async () => {
      await controller.findByReference('INS-1', SECRETARY, 'school-voisine');
      expect(service.findByReference).toHaveBeenCalledWith('school-1', 'INS-1');
    });

    it('applique la même règle à la réinscription en masse', async () => {
      await controller.bulkEnroll({} as any, SECRETARY, 'school-voisine');
      expect(service.bulkEnroll).toHaveBeenCalledWith(
        {},
        'school-1',
        'sec-1',
        SECRETARY,
      );
    });
  });

  describe('dossiers expirés', () => {
    it('cantonne la secrétaire à son établissement', async () => {
      await controller.findExpired(SECRETARY, 'school-voisine');

      expect(service.findExpired).toHaveBeenCalledWith('school-1');
      expect(service.findAllExpired).not.toHaveBeenCalled();
    });

    it('permet au SUPER_ADMIN de balayer toutes les écoles', async () => {
      await controller.findExpired(ADMIN);
      expect(service.findAllExpired).toHaveBeenCalled();
    });

    it('restreint le SUPER_ADMIN à l’école qu’il désigne', async () => {
      await controller.findExpired(ADMIN, 'school-2');

      expect(service.findExpired).toHaveBeenCalledWith('school-2');
      expect(service.findAllExpired).not.toHaveBeenCalled();
    });
  });

  describe('export des dossiers', () => {
    it('produit un fichier téléchargeable horodaté', async () => {
      await controller.exportEnrollments({} as any, res, SECRETARY);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('dossiers-CMB-'),
      );
      expect(res.send).toHaveBeenCalled();
    });

    it('porte la situation financière de chaque dossier', async () => {
      await controller.exportEnrollments({} as any, res, SECRETARY);

      // C'est le document de relance des familles : sans les montants, il ne
      // sert à rien.
      const columns = csv.build.mock.calls[0][0];
      const headers = columns.map((c: any) => c.header);
      expect(headers).toContain('Total dû (FCFA)');
      expect(headers).toContain('Reste à payer (FCFA)');

      const reste = columns.find(
        (c: any) => c.header === 'Reste à payer (FCFA)',
      );
      expect(reste.value(dossier)).toBe(60000);
    });

    it('formate la date de naissance en jour/mois/année', async () => {
      await controller.exportEnrollments({} as any, res, SECRETARY);

      const naissance = csv.build.mock.calls[0][0].find(
        (c: any) => c.header === 'Date de naissance',
      );
      expect(naissance.value(dossier)).toBe('05/03/2011');
    });

    it('laisse la date de naissance vide plutôt que d’échouer si elle manque', async () => {
      await controller.exportEnrollments({} as any, res, SECRETARY);

      const naissance = csv.build.mock.calls[0][0].find(
        (c: any) => c.header === 'Date de naissance',
      );
      expect(naissance.value({ student: {} })).toBe('');
    });

    it('traduit le statut en libellé lisible', async () => {
      await controller.exportEnrollments({} as any, res, SECRETARY);

      const statut = csv.build.mock.calls[0][0].find(
        (c: any) => c.header === 'Statut',
      );
      expect(statut.value(dossier)).not.toBe(EnrollmentStatus.PARTIALLY_PAID);
      expect(typeof statut.value(dossier)).toBe('string');
    });

    it('n’applique aucune pagination', async () => {
      await controller.exportEnrollments({ page: 2 } as any, res, SECRETARY);

      // L'export doit contenir tout le résultat filtré, pas la page affichée.
      expect(service.findAllForExport).toHaveBeenCalledWith('school-1', {
        page: 2,
      });
      expect(service.findAll).not.toHaveBeenCalled();
    });
  });
});
