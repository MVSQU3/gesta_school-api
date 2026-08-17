import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '../enums/role.enum';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/** Contexte d'exécution minimal, suffisant pour les gardes. */
const contextFor = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('RolesGuard (contrôle des rôles)', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  const withRequiredRoles = (roles: Role[] | undefined) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('laisse passer une route sans exigence de rôle', () => {
    withRequiredRoles(undefined);
    expect(guard.canActivate(contextFor({ user: { roles: [] } }))).toBe(true);
  });

  it('accepte un utilisateur portant le rôle exigé', () => {
    withRequiredRoles([Role.DIRECTOR]);
    expect(
      guard.canActivate(contextFor({ user: { roles: [Role.DIRECTOR] } })),
    ).toBe(true);
  });

  it('accepte dès qu’un seul des rôles exigés est porté', () => {
    withRequiredRoles([Role.DIRECTOR, Role.SECRETARY]);
    expect(
      guard.canActivate(contextFor({ user: { roles: [Role.SECRETARY] } })),
    ).toBe(true);
  });

  it('refuse un utilisateur sans le rôle exigé', () => {
    withRequiredRoles([Role.DIRECTOR]);
    expect(
      guard.canActivate(contextFor({ user: { roles: [Role.TEACHER] } })),
    ).toBe(false);
  });

  it('refuse une requête sans utilisateur', () => {
    withRequiredRoles([Role.DIRECTOR]);
    expect(guard.canActivate(contextFor({}))).toBe(false);
  });

  it('refuse un utilisateur dont les rôles sont absents', () => {
    withRequiredRoles([Role.DIRECTOR]);
    expect(guard.canActivate(contextFor({ user: {} }))).toBe(false);
  });

  it('ouvre tout au SUPER_ADMIN', () => {
    withRequiredRoles([Role.TEACHER]);
    expect(
      guard.canActivate(contextFor({ user: { roles: [Role.SUPER_ADMIN] } })),
    ).toBe(true);
  });
});

describe('JwtAuthGuard (mot de passe provisoire)', () => {
  let guard: JwtAuthGuard;
  let parentCanActivate: jest.SpyInstance;

  beforeEach(() => {
    guard = new JwtAuthGuard();
    parentCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype as any, 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => parentCanActivate.mockRestore());

  it('refuse quand le jeton lui-même est invalide', async () => {
    parentCanActivate.mockResolvedValue(false);

    await expect(guard.canActivate(contextFor({ user: {} }))).resolves.toBe(false);
  });

  it('laisse passer un compte au mot de passe définitif', async () => {
    await expect(
      guard.canActivate(contextFor({ user: { mustChangePassword: false } })),
    ).resolves.toBe(true);
  });

  it('bloque toute autre route tant que le mot de passe est provisoire', async () => {
    // Le contrôle est côté serveur : sans lui, un mot de passe provisoire
    // resterait utilisable par quiconque contourne l'écran d'invite.
    await expect(
      guard.canActivate(
        contextFor({
          user: { mustChangePassword: true },
          method: 'GET',
          path: '/api/v1/students',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('autorise la seule route de changement de mot de passe', async () => {
    await expect(
      guard.canActivate(
        contextFor({
          user: { mustChangePassword: true },
          method: 'PATCH',
          path: '/api/v1/auth/password',
        }),
      ),
    ).resolves.toBe(true);
  });

  it('n’autorise pas cette route avec un autre verbe', async () => {
    await expect(
      guard.canActivate(
        contextFor({
          user: { mustChangePassword: true },
          method: 'GET',
          path: '/api/v1/auth/password',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('expose un code exploitable par l’interface', async () => {
    const error = await guard
      .canActivate(
        contextFor({
          user: { mustChangePassword: true },
          method: 'GET',
          path: '/api/v1/students',
        }),
      )
      .catch((e) => e);

    // Permet à l'interface de basculer sur l'écran de changement plutôt que
    // d'afficher un refus générique.
    expect(error.getResponse()).toMatchObject({ code: 'MUST_CHANGE_PASSWORD' });
  });

  it('se rabat sur l’URL quand le chemin n’est pas fourni', async () => {
    await expect(
      guard.canActivate(
        contextFor({
          user: { mustChangePassword: true },
          method: 'PATCH',
          url: '/api/v1/auth/password',
        }),
      ),
    ).resolves.toBe(true);
  });
});
