import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
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
   * Dix tentatives par quart d'heure pour un couple (poste, compte).
   *
   * Assez large pour une secrétaire qui hésite entre deux mots de passe un
   * matin de rentrée, assez étroit pour rendre le forçage inopérant : le
   * compte est protégé indépendamment du poste utilisé par les collègues,
   * puisque le décompte porte sur le couple et non sur l'adresse seule.
   */
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000, by: 'ip+email' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /**
   * Changement de mot de passe par l'utilisateur connecté, quel que soit son
   * rôle. Renvoie un jeton neuf, les précédents étant révoqués.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthUser) {
    return this.authService.changePassword(user.id, dto);
  }
}
