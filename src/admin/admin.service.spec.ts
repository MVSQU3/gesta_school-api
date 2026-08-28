import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../common/enums/role.enum';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { User } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import { AuditService } from '../audit/audit.service';

describe('AdminService (administration de la plateforme)', () => {
  let service: AdminService;
  let repos: Record<string, any>;
  let queryBuilder: any;
  const ENV = process.env;

  beforeEach(async () => {
    process.env = { ...ENV };
    delete process.env.SUPER_ADMIN_PASSWORD;
    delete process.env.SUPER_ADMIN_EMAIL;
    delete process.env.NODE_ENV;

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
      getMany: jest.fn().mockResolvedValue([]),
    };

    repos = {
      student: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((d) => ({ ...d })),
        save: jest.fn((s) => Promise.resolve(s)),
      },
      school: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue({ id: 'school-1', slug: 'CMB' }),
        create: jest.fn((d) => ({ ...d })),
        save: jest.fn((s) => Promise.resolve(s)),
      },
      user: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((d) => ({ ...d })),
        save: jest.fn((u) => Promise.resolve(u)),
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(Student), useValue: repos.student },
        { provide: getRepositoryToken(School), useValue: repos.school },
        { provide: getRepositoryToken(User), useValue: repos.user },
            { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  afterEach(() => {
    process.env = ENV;
    jest.restoreAllMocks();
  });

  describe('amorçage du super-administrateur', () => {
    const withNoAdmin = () => queryBuilder.getCount.mockResolvedValue(0);

    it('ne crée rien s’il en existe déjà un', async () => {
      queryBuilder.getCount.mockResolvedValue(1);

      await service.onModuleInit();
      expect(repos.user.save).not.toHaveBeenCalled();
    });

    it('crée le compte avec le mot de passe fourni par l’environnement', async () => {
      withNoAdmin();
      process.env.SUPER_ADMIN_PASSWORD = 'motDePasseChoisi2026';
      process.env.SUPER_ADMIN_EMAIL = 'admin@gesta.ci';

      await service.onModuleInit();

      const created = repos.user.save.mock.calls[0][0];
      expect(created.email).toBe('admin@gesta.ci');
      await expect(
        bcrypt.compare('motDePasseChoisi2026', created.passwordHash),
      ).resolves.toBe(true);
    });

    it('n’impose pas de changement pour un mot de passe que vous avez choisi', async () => {
      withNoAdmin();
      process.env.SUPER_ADMIN_PASSWORD = 'motDePasseChoisi2026';

      await service.onModuleInit();
      expect(repos.user.save.mock.calls[0][0].mustChangePassword).toBe(false);
    });

    it('génère un mot de passe hors production et impose son remplacement', async () => {
      withNoAdmin();

      await service.onModuleInit();

      const created = repos.user.save.mock.calls[0][0];
      expect(created.mustChangePassword).toBe(true);
      expect(created.passwordHash).toBeTruthy();
    });

    it('n’affiche le mot de passe généré qu’une seule fois, à la création', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      withNoAdmin();

      await service.onModuleInit();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('provisoire'));
    });

    it('refuse de créer un compte en production sans mot de passe déclaré', async () => {
      withNoAdmin();
      process.env.NODE_ENV = 'production';

      // Mieux vaut une plateforme sans super-admin qu'un super-admin dont le
      // mot de passe est dans le dépôt.
      await service.onModuleInit();
      expect(repos.user.save).not.toHaveBeenCalled();
    });

    it('explique le refus dans les logs', async () => {
      const error = jest.spyOn(Logger.prototype, 'error');
      withNoAdmin();
      process.env.NODE_ENV = 'production';

      await service.onModuleInit();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('SUPER_ADMIN_PASSWORD'),
      );
    });
  });

  describe('mot de passe par défaut historique', () => {
    it('marque à changer un compte utilisant encore admin123', async () => {
      const legacyHash = await bcrypt.hash('admin123', 4);
      queryBuilder.getMany.mockResolvedValue([
        { email: 'old@gesta.ci', passwordHash: legacyHash, mustChangePassword: false },
      ]);

      await service.onModuleInit();

      // Le compte reste utilisable, mais la première action imposée sera d'en
      // définir un nouveau.
      expect(repos.user.save).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: true }),
      );
    });

    it('laisse intact un compte au mot de passe propre', async () => {
      const cleanHash = await bcrypt.hash('unAutreMotDePasse', 4);
      queryBuilder.getMany.mockResolvedValue([
        { email: 'ok@gesta.ci', passwordHash: cleanHash, mustChangePassword: false },
      ]);

      await service.onModuleInit();
      expect(repos.user.save).not.toHaveBeenCalled();
    });
  });

  describe('createUser', () => {
    const dto = (overrides: any = {}) => ({
      email: 'nouveau@ecole.ci',
      password: 'motDePasseSolide2026',
      roles: [Role.DIRECTOR],
      schoolId: 'school-1',
      ...overrides,
    });

    it('exige au moins un rôle', async () => {
      await expect(service.createUser(dto({ roles: [] }) as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuse de mêler SUPER_ADMIN à un rôle d’établissement', async () => {
      await expect(
        service.createUser(dto({ roles: [Role.SUPER_ADMIN, Role.DIRECTOR] }) as any),
      ).rejects.toThrow(/ne se combine avec aucun rôle/);
    });

    it('crée un administrateur de plateforme sans école de rattachement', async () => {
      const created = await service.createUser(
        dto({ roles: [Role.SUPER_ADMIN], schoolId: 'school-1' }) as any,
      );

      // Un SUPER_ADMIN porteur d'un schoolId serait trompeur : son pouvoir
      // s'étend de toute façon à tous les établissements.
      expect(created.schoolId).toBeUndefined();
      expect(created.slug).toBeUndefined();
    });

    it('refuse un email déjà pris', async () => {
      repos.user.findOne.mockResolvedValue({ id: 'existing' });

      await expect(service.createUser(dto() as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('exige une école cible pour un compte d’établissement', async () => {
      await expect(
        service.createUser(dto({ schoolId: undefined }) as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse une école cible inconnue', async () => {
      repos.school.findOne.mockResolvedValue(null);

      await expect(service.createUser(dto() as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('résout le code établissement depuis l’école cible', async () => {
      const created = await service.createUser(dto() as any);

      expect(created.slug).toBe('CMB');
      expect(created.schoolId).toBe('school-1');
    });

    it('hache le mot de passe', async () => {
      const created = await service.createUser(dto() as any);

      expect(created.passwordHash).not.toBe('motDePasseSolide2026');
      await expect(
        bcrypt.compare('motDePasseSolide2026', created.passwordHash),
      ).resolves.toBe(true);
    });
  });

  describe('createSchool', () => {
    it('refuse un code établissement déjà pris', async () => {
      repos.school.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createSchool({ name: 'École', slug: 'CMB' } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('lectures', () => {
    it('signale un élève inconnu', async () => {
      repos.student.findOne.mockResolvedValue(null);

      await expect(service.findOneStudent('student-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('signale un établissement inconnu', async () => {
      repos.school.findOne.mockResolvedValue(null);

      await expect(service.findOneSchool('school-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('liste les directeurs de toutes les écoles', async () => {
      await service.findAllDirectors();

      expect(queryBuilder.where).toHaveBeenCalledWith(
        ':role = ANY(user.roles)',
        { role: Role.DIRECTOR },
      );
    });
  });
});
