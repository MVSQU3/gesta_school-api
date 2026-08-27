import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { UpdatePeriodSystemDto } from './dto/update-period-system.dto';
import { resolveSchoolId } from '../common/utils/resolve-school';
import { School } from './entities/school.entity';
import { SchoolsService } from './schools.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/v1/schools')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}



  @Get()
  async findAll(@CurrentUser() user: AuthUser): Promise<School[]> {
    if (user.roles.includes(Role.SUPER_ADMIN)) {
      return await this.schoolsService.findAll();
    }
    // Toujours retourner un tableau pour que le front puisse faire .map() etc.
    const school = await this.schoolsService.findOne(user.schoolId);
    return school ? [school] : [];
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<School> {
    if (!user.roles.includes(Role.SUPER_ADMIN) && user.schoolId !== id) {
      throw new ForbiddenException(
        'Vous ne pouvez pas accéder aux informations de cette école.',
      );
    }
    return await this.schoolsService.findOne(id);
  }

  /**
   * Découpage de l'année scolaire de SON établissement.
   *
   * Ouvert au directeur, contrairement au reste de la modification d'école :
   * c'est une décision pédagogique qui lui appartient, et l'obliger à passer
   * par l'administrateur de la plateforme n'apporterait aucune sécurité.
   *
   * `resolveSchoolId` le ramène de force à son école ; seul le SUPER_ADMIN
   * peut en désigner une autre. Déclarée avant `@Patch(':id')`, sinon « me »
   * serait capté comme un identifiant.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch('me/period-system')
  async updatePeriodSystem(
    @Body() dto: UpdatePeriodSystemDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<School> {
    return await this.schoolsService.updatePeriodSystem(
      resolveSchoolId(user, querySchoolId),
      dto.periodSystem,
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateSchoolDto: UpdateSchoolDto,
  ): Promise<School> {
    return await this.schoolsService.update(id, updateSchoolDto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return await this.schoolsService.remove(id);
  }
}
