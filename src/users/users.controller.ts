import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from '../dto/index';
import { SetUserStatusDto, UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from '../auth/dto/change-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  /**
   * Résout l'école cible : celle du JWT, ou celle passée en query pour un admin.
   */
  private resolveSchoolId(user: AuthUser, querySchoolId?: string): string {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN)
      ? querySchoolId
      : user.schoolId;
    if (!schoolId) {
      throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    }
    return schoolId;
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post()
  async createStaff(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.usersService.createStaff(
      createUserDto,
      this.resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  /**
   * Personnel de l'établissement.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<User[]> {
    return await this.usersService.findAllBySchool(
      this.resolveSchoolId(user, querySchoolId),
    );
  }

  /**
   * Modification de l'email et des rôles d'un employé.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<User> {
    return await this.usersService.update(
      id,
      updateUserDto,
      this.resolveSchoolId(user, querySchoolId),
      user.id,
      user,
    );
  }

  /**
   * Activation / désactivation d'un compte (départ d'un employé).
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id/status')
  async setStatus(
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<User> {
    return await this.usersService.setActive(
      id,
      dto.isActive,
      this.resolveSchoolId(user, querySchoolId),
      user.id,
      user,
    );
  }

  /**
   * Réinitialisation du mot de passe d'un employé par la direction.
   * Ferme immédiatement ses sessions ouvertes.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id/password')
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    return await this.usersService.resetPassword(
      id,
      dto.newPassword,
      this.resolveSchoolId(user, querySchoolId),
      user.id,
      user,
    );
  }

  /**
   * Suppression définitive d'un compte.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    return await this.usersService.remove(
      id,
      this.resolveSchoolId(user, querySchoolId),
      user.id,
      user,
    );
  }
}
