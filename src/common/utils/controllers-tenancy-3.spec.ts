import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AdminController } from '../../admin/admin.controller';
import { AdminService } from '../../admin/admin.service';
import { AuthController } from '../../auth/auth.controller';
import { AuthService } from '../../auth/auth.service';
import { SESSION_COOKIE } from '../../auth/auth-cookie';
import { DashboardController } from '../../dashboard/dashboard.controller';
import { DashboardService } from '../../dashboard/dashboard.service';
import { HealthController } from '../../health/health.controller';
import { AuthUser } from '../decorators/current-user.decorator';
import { Role } from '../enums/role.enum';

const DIRECTOR = {
  id: 'dir-1',
  email: 'dir@ecole.ci',
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

describe('DashboardController (tableau de bord)', () => {
  let controller: DashboardController;
  let service: any;

  beforeEach(async () => {
    service = { getStats: jest.fn().mockResolvedValue({}) };
    const module = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: service }],
    }).compile();
    controller = module.get(DashboardController);
  });

  it('ignore le schoolId en query pour un directeur', async () => {
    await controller.getStats(DIRECTOR, undefined, 'school-voisine');
    expect(service.getStats).toHaveBeenCalledWith('school-1', undefined);
  });

  it('laisse le SUPER_ADMIN désigner l’établissement', async () => {
    await controller.getStats(ADMIN, undefined, 'school-2');
    expect(service.getStats).toHaveBeenCalledWith('school-2', undefined);
  });

  it('refuse un SUPER_ADMIN sans établissement désigné', async () => {
    await expect(controller.getStats(ADMIN)).rejects.toThrow(ForbiddenException);
  });

  it('transmet l’année demandée', async () => {
    await controller.getStats(DIRECTOR, 'year-past');
    expect(service.getStats).toHaveBeenCalledWith('school-1', 'year-past');
  });
});

describe('AdminController (administration de la plateforme)', () => {
  let controller: AdminController;
  let service: any;

  beforeEach(async () => {
    service = {
      createStudent: jest.fn().mockResolvedValue({}),
      findAllStudents: jest.fn().mockResolvedValue([]),
      findOneStudent: jest.fn().mockResolvedValue({}),
      findAllSchool: jest.fn().mockResolvedValue([]),
      findOneSchool: jest.fn().mockResolvedValue({}),
      createSchool: jest.fn().mockResolvedValue({}),
      createUser: jest.fn().mockResolvedValue({}),
      findAllUsers: jest.fn().mockResolvedValue([]),
      findAllDirectors: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: service }],
    }).compile();
    controller = module.get(AdminController);
  });

  it('exige une école cible pour enregistrer un élève', async () => {
    // L'administrateur n'a aucune école dans son jeton : sans ce paramètre,
    // la fiche partirait sans rattachement.
    await expect(controller.createStudent({} as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('enregistre l’élève dans l’école désignée', async () => {
    await controller.createStudent({} as any, 'school-2');
    expect(service.createStudent).toHaveBeenCalledWith({}, 'school-2');
  });

  it('délègue les lectures de la plateforme', async () => {
    await controller.findAllStudents();
    await controller.findOneStudent('st-1');
    await controller.findAllSchool();
    await controller.findOneSchool('school-1');

    expect(service.findAllStudents).toHaveBeenCalled();
    expect(service.findOneStudent).toHaveBeenCalledWith('st-1');
    expect(service.findAllSchool).toHaveBeenCalled();
    expect(service.findOneSchool).toHaveBeenCalledWith('school-1');
  });

  it('délègue la création d’un établissement et d’un compte', async () => {
    await controller.createSchool({ name: 'X', slug: 'X' } as any, ADMIN as any);
    await controller.createUser({ email: 'a@b.ci' } as any);

    expect(service.createSchool).toHaveBeenCalled();
    expect(service.createUser).toHaveBeenCalled();
  });
});

describe('AuthController (session)', () => {
  let controller: AuthController;
  let service: any;
  let res: any;

  beforeEach(async () => {
    service = {
      login: jest.fn().mockResolvedValue({
        access_token: 'jeton',
        user: { id: 'dir-1' },
      }),
      changePassword: jest.fn().mockResolvedValue({
        access_token: 'jeton-neuf',
        message: 'ok',
      }),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn(), status: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('dépose le jeton dans un cookie httpOnly à la connexion', async () => {
    await controller.login({ email: 'a@b.ci', password: 'x' } as any, res);

    // Le jeton n'est jamais accessible au JavaScript de la page : c'est ce
    // qui le met hors de portée d'une injection de script.
    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe(SESSION_COOKIE);
    expect(value).toBe('jeton');
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
  });

  it('efface le cookie à la déconnexion', () => {
    const result = controller.logout(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      expect.anything(),
    );
    expect(result.message).toBe('Déconnecté.');
  });

  it('renvoie le profil sans jamais exposer de secret', () => {
    const profile = controller.me(DIRECTOR);

    expect(profile).toEqual({
      id: 'dir-1',
      email: 'dir@ecole.ci',
      roles: [Role.DIRECTOR],
      slug: 'CMB',
      schoolId: 'school-1',
      mustChangePassword: false,
    });
  });

  it('remplace le cookie après un changement de mot de passe', async () => {
    await controller.changePassword({} as any, DIRECTOR, res);

    // La révocation par date coupe la session en cours : sans jeton de
    // remplacement, l'utilisateur se déconnecterait lui-même.
    expect(res.cookie.mock.calls[0][1]).toBe('jeton-neuf');
  });
});

describe('HealthController (sonde)', () => {
  let controller: HealthController;
  let dataSource: any;
  let res: any;

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    res = { status: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: getDataSourceToken(), useValue: dataSource }],
    }).compile();
    controller = module.get(HealthController);
  });

  it('interroge réellement la base', async () => {
    await controller.check(res);

    // Répondre 200 sans vérifier PostgreSQL maintiendrait en rotation une
    // instance incapable de servir la moindre requête.
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('répond « ok » quand la base est joignable', async () => {
    const report = await controller.check(res);

    expect(report.status).toBe('ok');
    expect(report.database.status).toBe('up');
    expect(typeof report.database.latencyMs).toBe('number');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('bascule en 503 quand la base est injoignable', async () => {
    dataSource.query.mockRejectedValue(new Error('connexion refusée'));

    const report = await controller.check(res);

    expect(report.status).toBe('degraded');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('remonte la cause de la panne', async () => {
    dataSource.query.mockRejectedValue(new Error('connexion refusée'));

    const report = await controller.check(res);
    expect(report.database.error).toBe('connexion refusée');
  });

  it('tolère une erreur qui n’est pas une Error', async () => {
    dataSource.query.mockRejectedValue('panne');

    const report = await controller.check(res);
    expect(report.database.error).toBe('erreur inconnue');
  });

  it('ne divulgue ni version, ni nom de base, ni variable d’environnement', async () => {
    const report = await controller.check(res);

    // La sonde est publique et non authentifiée.
    expect(Object.keys(report).sort()).toEqual([
      'database',
      'status',
      'timestamp',
      'uptimeSeconds',
    ]);
  });
});
