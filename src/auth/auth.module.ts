import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RateLimitGuard } from '../common/security/rate-limit.guard';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET as string,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  // RateLimitGuard est déclaré ici pour être un singleton du module : le
  // compteur de tentatives vit dans l'instance, une instanciation par requête
  // le remettrait à zéro à chaque appel et le rendrait inopérant.
  providers: [AuthService, JwtStrategy, RateLimitGuard],
  exports: [AuthService],
})
export class AuthModule {}
