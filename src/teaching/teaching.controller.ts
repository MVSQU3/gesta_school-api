import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { TeachingAssignment } from './entities/teaching-assignment.entity';
import { TeachingService } from './teaching.service';

@Controller('api/v1/teaching-assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeachingController {
  constructor(private readonly service: TeachingService) {}

  /**
   * Affectations de l'établissement. Un enseignant ne consulte que les
   * siennes : le filtre est forcé sur son identifiant.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('teacherId') teacherId?: string,
    @Query('classRoomId') classRoomId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TeachingAssignment[]> {
    const isTeacherOnly =
      user.roles.includes(Role.TEACHER) &&
      !user.roles.some((r) =>
        [Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY].includes(r),
      );

    return await this.service.findAll(resolveSchoolId(user, querySchoolId), {
      teacherId: isTeacherOnly ? user.id : teacherId,
      classRoomId,
      academicYearId,
    });
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post()
  async create(
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TeachingAssignment> {
    return await this.service.create(dto, resolveSchoolId(user, querySchoolId));
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
