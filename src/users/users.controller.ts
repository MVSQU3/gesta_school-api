import { Controller, Post, Body, UseGuards, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post()
  async create(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() currentUser: any,
  ) {
    // Si c'est un directeur, il ne peut créer que des comptes pour son établissement (schoolId & slug)
    if (!currentUser.roles.includes(Role.SUPER_ADMIN)) {
      if (createUserDto.roles.includes(Role.SUPER_ADMIN) || createUserDto.roles.includes(Role.DIRECTOR)) {
        throw new UnauthorizedException("Un directeur ne peut créer que des Secrétaires ou des Comptables.");
      }
      
      // On force le rattachement à l'école du directeur
      createUserDto.schoolId = currentUser.schoolId;
      createUserDto.slug = currentUser.slug;
    }

    return await this.usersService.create(createUserDto);
  }
}
