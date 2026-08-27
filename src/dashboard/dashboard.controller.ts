import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DashboardService, DashboardStats } from './dashboard.service';
import { resolveSchoolId } from '../common/utils/resolve-school';

@Controller('api/v1/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Statistiques consolidées de l'établissement pour une année scolaire.
   * Sans `academicYearId`, l'année active est utilisée.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get()
  async getStats(
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<DashboardStats> {
    const schoolId = resolveSchoolId(user, querySchoolId);
    return await this.dashboardService.getStats(schoolId, academicYearId);
  }
}
