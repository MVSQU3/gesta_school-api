import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  /**
   * Changement de mot de passe par l'utilisateur lui-même.
   *
   * Un jeton neuf est renvoyé : la révocation par date coupe toutes les
   * sessions antérieures, y compris celle depuis laquelle l'opération est
   * lancée. Sans ce jeton de remplacement, l'utilisateur se déconnecterait
   * lui-même en changeant son mot de passe.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ access_token: string; message: string }> {
    const user = await this.usersService.changeOwnPassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );

    return {
      access_token: this.jwtService.sign({
        sub: user.id,
        email: user.email,
        roles: user.roles,
        slug: user.slug,
        schoolId: user.schoolId,
      }),
      message:
        'Mot de passe modifié. Vos autres sessions ont été déconnectées.',
    };
  }

  async login(loginDto: LoginDto): Promise<{ access_token: string; user: Partial<User> }> {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Identifiants incorrects');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Identifiants incorrects');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        "Ce compte a été désactivé. Rapprochez-vous de la direction de l'établissement.",
      );
    }

    if (!user.roles.includes(Role.SUPER_ADMIN)) {
      /**
       * Le code établissement est comparé sans tenir compte de la casse ni des
       * espaces qui l'entourent.
       *
       * Il est stocké en majuscules — `SchoolsService` l'y ramène à l'écriture
       * — mais il est saisi à la main, souvent sur un clavier de téléphone qui
       * ne bascule pas en majuscules de lui-même. Comparer strictement
       * refusait « cmb » à qui possédait pourtant les bons identifiants, avec
       * un message parlant d'un slug « incorrect » alors qu'il était bon.
       *
       * Ce n'est pas un assouplissement du contrôle : le code reste exigé, et
       * doit toujours désigner l'établissement du compte. Seule la forme de la
       * saisie est tolérée, comme elle l'est déjà pour l'email.
       */
      const submittedSlug = loginDto.slug?.trim().toUpperCase();

      if (!submittedSlug) {
        throw new UnauthorizedException("Le slug de l'établissement est requis pour se connecter");
      }
      if (user.slug?.trim().toUpperCase() !== submittedSlug) {
        throw new UnauthorizedException('Slug établissement incorrect');
      }
    }

    const payload = { 
      sub: user.id, 
      email: user.email, 
      roles: user.roles,
      slug: user.slug,
      schoolId: user.schoolId 
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        roles: user.roles,
        slug: user.slug,
        schoolId: user.schoolId,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }
}
