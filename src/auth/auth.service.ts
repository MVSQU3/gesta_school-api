import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto): Promise<{ access_token: string; user: Partial<User> }> {
    const user = await this.usersService.findByEmail(loginDto.email);
    console.log('User:', user);
    if (!user) {
      throw new UnauthorizedException('Identifiants incorrects');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Identifiants incorrects');
    }

    if (!user.roles.includes(Role.SUPER_ADMIN)) {
      if (!loginDto.slug) {
        throw new UnauthorizedException("Le slug de l'établissement est requis pour se connecter");
      }
      if (user.slug !== loginDto.slug) {
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
      },
    };
  }
}
