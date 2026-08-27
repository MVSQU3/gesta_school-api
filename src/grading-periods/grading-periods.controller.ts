import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { resolveSchoolId } from '../common/utils/resolve-school';
import { UpdateGradingPeriodDto } from './dto/update-grading-period.dto';
import { GradingPeriod } from './entities/grading-period.entity';
import { GradingPeriodsService } from './grading-periods.service';

@Controller('api/v1/grading-periods')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GradingPeriodsController {
  constructor(private readonly service: GradingPeriodsService) {}

  /** Périodes d'une année scolaire (trimestres ou semestres). */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get()
  async findAll(
    @Query('academicYearId') academicYearId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<GradingPeriod[]> {
    return await this.service.findAllByYear(
      resolveSchoolId(user, querySchoolId),
      academicYearId,
    );
  }

  /**
   * Régénère les périodes d'une année selon le découpage actuel de l'école.
   * Refusé dès qu'une note ou une absence y est rattachée.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post('regenerate')
  async regenerate(
    @Query('academicYearId') academicYearId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<GradingPeriod[]> {
    return await this.service.regenerateForAcademicYear(
      academicYearId,
      resolveSchoolId(user, querySchoolId),
    );
  }

  /** Renommage, dates, ouverture ou clôture d'une période. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGradingPeriodDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<GradingPeriod> {
    return await this.service.update(
      id,
      dto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    return await this.service.remove(id, resolveSchoolId(user, querySchoolId));
  }
}
