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
import {
  CreateScheduleEntryDto,
  CreateTimeSlotDto,
  MoveScheduleEntryDto,
  UpdateTimeSlotDto,
} from './dto/schedule.dto';
import { ScheduleEntry } from './entities/schedule-entry.entity';
import { TimeSlot } from './entities/time-slot.entity';
import {
  AssignmentUsage,
  ScheduleGrid,
  ScheduleService,
} from './schedule.service';

/**
 * Emploi du temps.
 *
 * La consultation est largement ouverte — l'emploi du temps d'une classe n'a
 * rien de confidentiel et sert au quotidien à tout l'établissement. La
 * composition, elle, reste au directeur : c'est un arbitrage sur le service
 * des enseignants.
 */
@Controller('api/v1/schedule')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScheduleController {
  constructor(private readonly service: ScheduleService) {}

  /* ─── Grille horaire ─────────────────────────────────────────────────── */

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get('slots')
  async findSlots(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TimeSlot[]> {
    return await this.service.findSlots(resolveSchoolId(user, querySchoolId));
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post('slots')
  async createSlot(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTimeSlotDto,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TimeSlot> {
    return await this.service.createSlot(
      resolveSchoolId(user, querySchoolId),
      dto,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch('slots/:id')
  async updateSlot(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTimeSlotDto,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<TimeSlot> {
    return await this.service.updateSlot(
      id,
      resolveSchoolId(user, querySchoolId),
      dto,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete('slots/:id')
  async removeSlot(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    await this.service.removeSlot(id, resolveSchoolId(user, querySchoolId));
    return { message: 'Créneau supprimé.' };
  }

  /* ─── Consultation ───────────────────────────────────────────────────── */

  /** Emploi du temps de l'enseignant connecté. */
  @Roles(Role.TEACHER, Role.DIRECTOR, Role.SUPER_ADMIN)
  @Get('mine')
  async mine(
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ScheduleGrid> {
    return await this.service.getTeacherSchedule(
      resolveSchoolId(user, querySchoolId),
      user.id,
      academicYearId,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get('class/:classRoomId')
  async classSchedule(
    @Param('classRoomId') classRoomId: string,
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ScheduleGrid> {
    return await this.service.getClassSchedule(
      resolveSchoolId(user, querySchoolId),
      classRoomId,
      academicYearId,
    );
  }

  /** Emploi du temps d'un enseignant donné — arbitrage de service. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get('teacher/:teacherId')
  async teacherSchedule(
    @Param('teacherId') teacherId: string,
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ScheduleGrid> {
    return await this.service.getTeacherSchedule(
      resolveSchoolId(user, querySchoolId),
      teacherId,
      academicYearId,
    );
  }

  /** Ce qui peut être posé dans la grille d'une classe. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get('class/:classRoomId/assignments')
  async classAssignments(
    @Param('classRoomId') classRoomId: string,
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<AssignmentUsage[]> {
    return await this.service.getClassAssignments(
      resolveSchoolId(user, querySchoolId),
      classRoomId,
      academicYearId,
    );
  }

  /* ─── Composition ────────────────────────────────────────────────────── */

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post('entries')
  async createEntry(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateScheduleEntryDto,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ScheduleEntry> {
    return await this.service.createEntry(
      resolveSchoolId(user, querySchoolId),
      dto,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch('entries/:id')
  async moveEntry(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: MoveScheduleEntryDto,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ScheduleEntry> {
    return await this.service.moveEntry(
      id,
      resolveSchoolId(user, querySchoolId),
      dto,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete('entries/:id')
  async removeEntry(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    await this.service.removeEntry(id, resolveSchoolId(user, querySchoolId));
    return { message: 'Séance retirée de l’emploi du temps.' };
  }
}
