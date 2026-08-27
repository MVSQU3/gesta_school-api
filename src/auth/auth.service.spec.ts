import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Role } from '../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService (connexion)', () => {
  let service: AuthService;
  let usersService: any;
  let jwtService: any;

  const PASSWORD = 'motdepasseSolide2026';
  let hash: string;

  const account = (overrides: any = {}) => ({
    id: 'user-1',
    email: 'dir@ecole.ci',
    passwordHash: hash,
    roles: [Role.DIRECTOR],
    slug: 'CMB',
    schoolId: 'school-1',
    isActive: true,
    mustChangePassword: false,
    ...overrides,
  });

  beforeAll(async () => {
    hash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), changeOwnPassword: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('jeton-signe') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('connecte un compte valide', async () => {
      usersService.findByEmail.mockResolvedValue(account());

      const result = await service.login({
        email: 'dir@ecole.ci',
        password: PASSWORD,
        slug: 'CMB',
      } as any);

      expect(result.access_token).toBe('jeton-signe');
      expect(result.user.email).toBe('dir@ecole.ci');
    });

    it('ne renvoie jamais le hash du mot de passe', async () => {
      usersService.findByEmail.mockResolvedValue(account());

      const result = await service.login({
        email: 'dir@ecole.ci',
        password: PASSWORD,
        slug: 'CMB',
      } as any);

      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('donne le même message pour un email inconnu et un mot de passe faux', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const unknownEmail = await service
        .login({ email: 'inconnu@ecole.ci', password: PASSWORD, slug: 'CMB' } as any)
        .catch((e) => e.message);

      usersService.findByEmail.mockResolvedValue(account());
      const wrongPassword = await service
        .login({ email: 'dir@ecole.ci', password: 'faux', slug: 'CMB' } as any)
        .catch((e) => e.message);

      // Deux messages distincts permettraient d'énumérer les comptes existants.
      expect(unknownEmail).toBe('Identifiants incorrects');
      expect(wrongPassword).toBe('Identifiants incorrects');
    });

    it('refuse un compte désactivé', async () => {
      usersService.findByEmail.mockResolvedValue(account({ isActive: false }));

      await expect(
        service.login({ email: 'dir@ecole.ci', password: PASSWORD, slug: 'CMB' } as any),
      ).rejects.toThrow(/désactivé/);
    });

    it('vérifie le mot de passe avant l’état du compte', async () => {
      usersService.findByEmail.mockResolvedValue(account({ isActive: false }));

      // Un compte désactivé ne doit pas se trahir face à un mauvais mot de
      // passe : la réponse doit rester le message générique.
      await expect(
        service.login({ email: 'dir@ecole.ci', password: 'faux', slug: 'CMB' } as any),
      ).rejects.toThrow('Identifiants incorrects');
    });

    it('exige le slug de l’établissement pour le personnel', async () => {
      usersService.findByEmail.mockResolvedValue(account());

      await expect(
        service.login({ email: 'dir@ecole.ci', password: PASSWORD } as any),
      ).rejects.toThrow(/slug de l'établissement est requis/);
    });

    it('accepte le code établissement saisi en minuscules', async () => {
      usersService.findByEmail.mockResolvedValue(account());

      // Le code est stocké en majuscules mais saisi à la main, souvent sur un
      // clavier de téléphone : « cmb » désigne bien le même établissement.
      await expect(
        service.login({
          email: 'dir@ecole.ci',
          password: PASSWORD,
          slug: 'cmb',
        } as any),
      ).resolves.toEqual(
        expect.objectContaining({ access_token: expect.any(String) }),
      );
    });

    it('tolère les espaces autour du code établissement', async () => {
      usersService.findByEmail.mockResolvedValue(account());

      await expect(
        service.login({
          email: 'dir@ecole.ci',
          password: PASSWORD,
          slug: '  Cmb  ',
        } as any),
      ).resolves.toEqual(
        expect.objectContaining({ access_token: expect.any(String) }),
      );
    });

    it('refuse un code établissement vide ou fait d’espaces', async () => {
      usersService.findByEmail.mockResolvedValue(account());

      // La tolérance sur la forme ne doit pas transformer une saisie vide en
      // absence de contrôle.
      await expect(
        service.login({
          email: 'dir@ecole.ci',
          password: PASSWORD,
          slug: '   ',
        } as any),
      ).rejects.toThrow(/slug de l'établissement est requis/);
    });

    it('refuse un slug qui n’est pas celui du compte', async () => {
      usersService.findByEmail.mockResolvedValue(account());

      // Sans ce contrôle, le personnel d'une école pourrait se connecter en se
      // présentant comme celui d'une autre.
      await expect(
        service.login({
          email: 'dir@ecole.ci',
          password: PASSWORD,
          slug: 'AUTRE',
        } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('dispense le SUPER_ADMIN de slug, n’étant rattaché à aucune école', async () => {
      usersService.findByEmail.mockResolvedValue(
        account({ roles: [Role.SUPER_ADMIN], slug: null, schoolId: null }),
      );

      await expect(
        service.login({ email: 'admin@gesta.ci', password: PASSWORD } as any),
      ).resolves.toHaveProperty('access_token');
    });

    it('place l’école et les rôles dans le jeton', async () => {
      usersService.findByEmail.mockResolvedValue(account());

      await service.login({
        email: 'dir@ecole.ci',
        password: PASSWORD,
        slug: 'CMB',
      } as any);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'dir@ecole.ci',
        roles: [Role.DIRECTOR],
        slug: 'CMB',
        schoolId: 'school-1',
      });
    });

    it('signale un mot de passe provisoire à l’interface', async () => {
      usersService.findByEmail.mockResolvedValue(
        account({ mustChangePassword: true }),
      );

      const result = await service.login({
        email: 'dir@ecole.ci',
        password: PASSWORD,
        slug: 'CMB',
      } as any);

      expect(result.user.mustChangePassword).toBe(true);
    });
  });

  describe('changePassword', () => {
    it('renvoie un jeton de remplacement', async () => {
      usersService.changeOwnPassword.mockResolvedValue(account());

      const result = await service.changePassword('user-1', {
        currentPassword: PASSWORD,
        newPassword: 'nouveauMotDePasse2026',
      } as any);

      // La révocation par date coupe toutes les sessions antérieures, y
      // compris celle en cours : sans jeton neuf, l'utilisateur se
      // déconnecterait lui-même en changeant son mot de passe.
      expect(result.access_token).toBe('jeton-signe');
    });

    it('laisse remonter le refus du service de comptes', async () => {
      usersService.changeOwnPassword.mockRejectedValue(
        new UnauthorizedException('Le mot de passe actuel est incorrect.'),
      );

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'faux',
          newPassword: 'nouveau',
        } as any),
      ).rejects.toThrow(UnauthorizedException);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });
});
