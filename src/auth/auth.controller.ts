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

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
