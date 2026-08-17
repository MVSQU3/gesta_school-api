import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { Role } from '../common/enums/role.enum';
import { School } from '../schools/entities/school.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * Ce service porte le contrôle d'accès de l'application. C'est ici qu'une
 * faille d'escalade de privilèges avait été trouvée à l'audit : `createStaff`
 * recopiait les rôles sans les filtrer, si bien qu'un directeur pouvait se
 * fabriquer un SUPER_ADMIN et prendre la main sur les écoles voisines. Chaque
 * garde-fou a donc son test.
 */
describe('UsersService (comptes et contrôle d’accès)', () => {
  let service: UsersService;
  let userRepo: any;
  let schoolRepo: any;
  let audit: any;
  let queryBuilder: any;

  const SCHOOL = { id: 'school-1', slug: 'CMB' };

  const staff = (overrides: any = {}) => ({
    id: 'user-1',
    email: 'secretaire@ecole.ci',
    schoolId: 'school-1',
    roles: [Role.SECRETARY],
    isActive: true,
    passwordHash: 'hash',
    mustChangePassword: false,
    ...overrides,
  });

  beforeEach(async () => {
    queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getCount: jest.fn().mockResolvedValue(1),
    };

    userRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((u) => Promise.resolve(u)),
      remove: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    schoolRepo = { findOne: jest.fn().mockResolvedValue(SCHOOL) };
    audit = { record: jest.fn(), diff: jest.fn().mockReturnValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(School), useValue: schoolRepo },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('createStaff', () => {
    const dto = (roles: Role[]) => ({
      email: 'nouveau@ecole.ci',
      password: 'motdepasseSolide2026',
      roles,
    });

    it('refuse la création d’un compte SUPER_ADMIN', async () => {
      // La faille d'escalade de privilèges corrigée à l'audit : sans ce refus,
      // un directeur pouvait s'octroyer l'accès à tous les établissements.
      await expect(
        service.createStaff(dto([Role.SUPER_ADMIN]) as any, 'school-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('refuse SUPER_ADMIN même mêlé à un rôle légitime', async () => {
      await expect(
        service.createStaff(
          dto([Role.SECRETARY, Role.SUPER_ADMIN]) as any,
          'school-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('exige au moins un rôle', async () => {
      await expect(
        service.createStaff(dto([]) as any, 'school-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse un établissement inconnu', async () => {
      schoolRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createStaff(dto([Role.SECRETARY]) as any, 'school-x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse un email déjà pris', async () => {
      userRepo.findOne.mockResolvedValue(staff());

      await expect(
        service.createStaff(dto([Role.SECRETARY]) as any, 'school-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('hache le mot de passe et ne le conserve jamais en clair', async () => {
      const created = await service.createStaff(
        dto([Role.SECRETARY]) as any,
        'school-1',
      );

      expect(created.passwordHash).not.toBe('motdepasseSolide2026');
      await expect(
        bcrypt.compare('motdepasseSolide2026', created.passwordHash),
      ).resolves.toBe(true);
    });

    it('rattache le compte à l’école résolue, jamais à celle demandée', async () => {
      const created = await service.createStaff(
        { ...dto([Role.SECRETARY]), schoolId: 'school-pirate' } as any,
        'school-1',
      );

      // Le schoolId et le slug viennent de l'école chargée en base : un
      // schoolId glissé dans le corps de requête est sans effet.
      expect(created.schoolId).toBe('school-1');
      expect(created.slug).toBe('CMB');
    });

    it('journalise la création', async () => {
      await service.createStaff(dto([Role.SECRETARY]) as any, 'school-1');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'users', schoolId: 'school-1' }),
        undefined,
      );
    });
  });

  describe('changeOwnPassword', () => {
    const withAccount = async (password: string) => {
      const hash = await bcrypt.hash(password, 4);
      queryBuilder.getOne.mockResolvedValue(staff({ passwordHash: hash }));
    };

    it('exige le mot de passe actuel', async () => {
      await withAccount('ancienMotDePasse');

      // Sans lui, une session laissée ouverte sur un poste partagé suffirait
      // à confisquer le compte.
      await expect(
        service.changeOwnPassword('user-1', 'mauvais', 'nouveauMotDePasse'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuse un compte inexistant', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.changeOwnPassword('user-x', 'a', 'b'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse de réutiliser le mot de passe actuel', async () => {
      await withAccount('ancienMotDePasse');

      await expect(
        service.changeOwnPassword('user-1', 'ancienMotDePasse', 'ancienMotDePasse'),
      ).rejects.toThrow(BadRequestException);
    });

    it('remplace le hash et lève la contrainte de changement', async () => {
      await withAccount('ancienMotDePasse');

      const saved = await service.changeOwnPassword(
        'user-1',
        'ancienMotDePasse',
        'nouveauMotDePasse',
      );

      await expect(
        bcrypt.compare('nouveauMotDePasse', saved.passwordHash),
      ).resolves.toBe(true);
      expect(saved.mustChangePassword).toBe(false);
    });

    it('horodate la révocation à la seconde entière', async () => {
      await withAccount('ancienMotDePasse');

      const saved = await service.changeOwnPassword(
        'user-1',
        'ancienMotDePasse',
        'nouveauMotDePasse',
      );

      // `iat` d'un JWT est en secondes : garder les millisecondes ferait
      // rejeter le jeton de remplacement dès son émission.
      expect(saved.passwordChangedAt!.getMilliseconds()).toBe(0);
    });
  });

  describe('resetPassword', () => {
    beforeEach(() => userRepo.findOne.mockResolvedValue(staff()));

    it('génère un mot de passe provisoire quand aucun n’est fourni', async () => {
      const result = await service.resetPassword(
        'user-1',
        undefined,
        'school-1',
        'director-1',
      );

      expect(result.temporaryPassword).toBeTruthy();
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    });

    it('impose le changement à la prochaine connexion', async () => {
      await service.resetPassword('user-1', undefined, 'school-1', 'director-1');

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: true }),
      );
    });

    it('empêche un directeur de réinitialiser son propre mot de passe', async () => {
      userRepo.findOne.mockResolvedValue(staff({ id: 'director-1' }));

      // Cela contournerait la vérification du mot de passe actuel.
      await expect(
        service.resetPassword('director-1', undefined, 'school-1', 'director-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('ne journalise jamais le mot de passe provisoire', async () => {
      const result = await service.resetPassword(
        'user-1',
        undefined,
        'school-1',
        'director-1',
      );

      // Le journal d'audit est consultable : il ne doit pas devenir un
      // annuaire de secrets.
      const logged = JSON.stringify(audit.record.mock.calls[0][0]);
      expect(logged).not.toContain(result.temporaryPassword);
    });

    it('accepte un mot de passe imposé par la direction', async () => {
      const result = await service.resetPassword(
        'user-1',
        '  motDePasseImpose  ',
        'school-1',
        'director-1',
      );

      expect(result.temporaryPassword).toBe('motDePasseImpose');
    });
  });

  describe('cloisonnement du personnel', () => {
    it('refuse un employé d’un autre établissement', async () => {
      userRepo.findOne.mockResolvedValue(staff({ schoolId: 'school-2' }));

      await expect(
        service.update('user-1', {}, 'school-1', 'director-1'),
      ).rejects.toThrow(/n'appartient pas à votre établissement/);
    });

    it('refuse de toucher à un compte d’administration de la plateforme', async () => {
      userRepo.findOne.mockResolvedValue(
        staff({ roles: [Role.SUPER_ADMIN], schoolId: 'school-1' }),
      );

      await expect(
        service.remove('user-1', 'school-1', 'director-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuse un employé inconnu', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('user-x', {}, 'school-1', 'director-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('exige un établissement résolu', async () => {
      await expect(
        service.update('user-1', {}, '', 'director-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.findAllBySchool('')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    beforeEach(() => userRepo.findOne.mockResolvedValue(staff()));

    it('refuse d’attribuer SUPER_ADMIN par modification', async () => {
      await expect(
        service.update(
          'user-1',
          { roles: [Role.SUPER_ADMIN] } as any,
          'school-1',
          'director-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('empêche un directeur de se retirer son propre rôle', async () => {
      userRepo.findOne.mockResolvedValue(
        staff({ id: 'director-1', roles: [Role.DIRECTOR] }),
      );

      // Il perdrait l'accès à l'espace de gestion sans pouvoir se le rendre.
      await expect(
        service.update(
          'director-1',
          { roles: [Role.SECRETARY] } as any,
          'school-1',
          'director-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('laisse un directeur modifier le rôle d’un autre employé', async () => {
      await expect(
        service.update(
          'user-1',
          { roles: [Role.ACCOUNTANT] } as any,
          'school-1',
          'director-1',
        ),
      ).resolves.toBeDefined();
    });

    it('refuse un email déjà utilisé', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(staff())
        .mockResolvedValueOnce(staff({ id: 'autre' }));

      await expect(
        service.update(
          'user-1',
          { email: 'pris@ecole.ci' } as any,
          'school-1',
          'director-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('journalise l’écart tel qu’il était avant la modification', async () => {
      audit.diff.mockReturnValue({
        roles: { before: [Role.SECRETARY], after: [Role.ACCOUNTANT] },
      });

      await service.update(
        'user-1',
        { roles: [Role.ACCOUNTANT] } as any,
        'school-1',
        'director-1',
      );

      // L'état d'avant est capturé en amont de la mutation : le relire après
      // coup ne montrerait plus aucun écart.
      expect(audit.diff).toHaveBeenCalledWith(
        { email: 'secretaire@ecole.ci', roles: [Role.SECRETARY] },
        expect.anything(),
      );
    });

    it('ne journalise rien quand rien n’a changé', async () => {
      audit.diff.mockReturnValue(null);

      await service.update('user-1', {}, 'school-1', 'director-1');
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('setActive', () => {
    it('empêche de désactiver son propre compte', async () => {
      userRepo.findOne.mockResolvedValue(staff({ id: 'director-1' }));

      await expect(
        service.setActive('director-1', false, 'school-1', 'director-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse de désactiver le dernier directeur actif', async () => {
      userRepo.findOne.mockResolvedValue(staff({ roles: [Role.DIRECTOR] }));
      queryBuilder.getCount.mockResolvedValue(0);

      // Une école sans directeur actif devient impossible à administrer.
      await expect(
        service.setActive('user-1', false, 'school-1', 'director-1'),
      ).rejects.toThrow(/dernier directeur actif/);
    });

    it('accepte de désactiver un directeur s’il en reste un autre', async () => {
      userRepo.findOne.mockResolvedValue(staff({ roles: [Role.DIRECTOR] }));
      queryBuilder.getCount.mockResolvedValue(1);

      const saved = await service.setActive('user-1', false, 'school-1', 'director-1');
      expect(saved.isActive).toBe(false);
    });

    it('ne compte pas les directeurs pour une réactivation', async () => {
      userRepo.findOne.mockResolvedValue(
        staff({ roles: [Role.DIRECTOR], isActive: false }),
      );

      await service.setActive('user-1', true, 'school-1', 'director-1');
      expect(queryBuilder.getCount).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('empêche de supprimer son propre compte', async () => {
      userRepo.findOne.mockResolvedValue(staff({ id: 'director-1' }));

      await expect(
        service.remove('director-1', 'school-1', 'director-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse de supprimer le dernier directeur', async () => {
      userRepo.findOne.mockResolvedValue(staff({ roles: [Role.DIRECTOR] }));
      queryBuilder.getCount.mockResolvedValue(0);

      await expect(
        service.remove('user-1', 'school-1', 'director-1'),
      ).rejects.toThrow(/dernier directeur/);
    });

    it('supprime un employé ordinaire', async () => {
      const user = staff();
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.remove('user-1', 'school-1', 'director-1');
      expect(userRepo.remove).toHaveBeenCalledWith(user);
      expect(result.message).toContain('secretaire@ecole.ci');
    });

    it('journalise l’email et les rôles avant suppression', async () => {
      userRepo.findOne.mockResolvedValue(staff());

      await service.remove('user-1', 'school-1', 'director-1');

      // L'objet est supprimé : capturer après coup laisserait un journal vide.
      expect(audit.record.mock.calls[0][0].summary).toContain(
        'secretaire@ecole.ci',
      );
    });
  });

  describe('lecture', () => {
    it('remonte explicitement le hash pour l’authentification', async () => {
      queryBuilder.getOne.mockResolvedValue(staff());

      await service.findByEmail('secretaire@ecole.ci');

      // La colonne est en `select: false` pour ne jamais fuiter dans les
      // réponses d'API : l'authentification doit la redemander.
      expect(queryBuilder.addSelect).toHaveBeenCalledWith('user.passwordHash');
    });

    it('ne remonte pas le hash pour la validation d’un jeton', async () => {
      userRepo.findOne.mockResolvedValue(staff());

      await service.findByIdForAuth('user-1');
      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('liste le personnel du seul établissement demandé', async () => {
      await service.findAllBySchool('school-1');

      expect(userRepo.find).toHaveBeenCalledWith({
        where: { schoolId: 'school-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
