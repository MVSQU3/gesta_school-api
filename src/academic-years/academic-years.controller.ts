import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Query,
} from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { AcademicYear } from './entities/academic-year.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { resolveSchoolId } from '../common/utils/resolve-school';

@Controller('api/v1/academic-years')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicYearsController {
  constructor(private readonly academicYearsService: AcademicYearsService) {}

  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTOR,
    Role.SECRETARY,
    Role.ACCOUNTANT,
    Role.TEACHER,
  )
  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<AcademicYear[]> {
    if (user.roles.includes(Role.SUPER_ADMIN) && !querySchoolId) {
      return await this.academicYearsService.findAll();
    }
    const schoolId = resolveSchoolId(user, querySchoolId);
    return await this.academicYearsService.findAllBySchool(schoolId);
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post()
  async create(
    @Body() createAcademicYearDto: CreateAcademicYearDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<AcademicYear> {
    return await this.academicYearsService.create(
      createAcademicYearDto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  /**
   * Modification du libellé, ou activation / clôture de l'année.
   * Activer une année clôture automatiquement celle qui était en cours.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateAcademicYearDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<AcademicYear> {
    return await this.academicYearsService.update(
      id,
      updateDto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  /**
   * Suppression d'une année, refusée si des inscriptions y sont rattachées.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    return await this.academicYearsService.remove(
      id,
      resolveSchoolId(user, querySchoolId),
    );
  }
}
