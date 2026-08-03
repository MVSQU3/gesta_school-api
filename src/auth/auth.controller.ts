import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { clearSessionCookie, setSessionCookie } from './auth-cookie';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '../common/security/rate-limit.guard';

@Controller('api/v1/auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Connexion. Le jeton est déposé dans un cookie httpOnly : l'interface web
   * n'a plus à le manipuler, et le JavaScript de la page ne peut plus le lire.
   *
   * Il reste renvoyé dans le corps pour les clients non-navigateur (scripts
   * d'intégration, sondes, tests), qui n'ont pas de gestionnaire de cookies.
   *
   * Dix tentatives par quart d'heure pour un couple (poste, compte).
   * Assez large pour une secrétaire qui hésite entre deux mots de passe un
   * matin de rentrée, assez étroit pour rendre le forçage inopérant : le
   * compte est protégé indépendamment du poste utilisé par les collègues,
   * puisque le décompte porte sur le couple et non sur l'adresse seule.
   */
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000, by: 'ip+email' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);
    setSessionCookie(res, result.access_token);
    return result;
  }

  /**
   * Déconnexion : efface le cookie de session.
   *
   * Une opération serveur est indispensable — un cookie httpOnly ne peut pas
   * être supprimé par le JavaScript de la page, c'est précisément sa raison
   * d'être.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
    return { message: 'Déconnecté.' };
  }

  /**
   * Profil de l'utilisateur connecté.
   *
   * Permet à l'interface de rétablir la session au rechargement de la page :
   * le jeton lui étant désormais invisible, elle ne peut plus en déduire
   * l'identité de l'utilisateur.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
      slug: user.slug,
      schoolId: user.schoolId,
      mustChangePassword: user.mustChangePassword ?? false,
    };
  }

  /**
   * Changement de mot de passe par l'utilisateur connecté, quel que soit son
   * rôle. Les jetons antérieurs sont révoqués : le cookie est remplacé dans la
   * foulée, faute de quoi l'utilisateur se déconnecterait lui-même.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePassword(user.id, dto);
    setSessionCookie(res, result.access_token);
    return result;
  }
}
