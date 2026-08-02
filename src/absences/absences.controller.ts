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
import { AbsencesService } from './absences.service';
import { RecordAbsencesDto, UpdateAbsenceDto } from './dto/absence.dto';
import { Absence } from './entities/absence.entity';

@Controller('api/v1/absences')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AbsencesController {
  constructor(private readonly service: AbsencesService) {}

  /** Appel d'une classe pour une date : enregistre les absents. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Post()
  async record(
    @Body() dto: RecordAbsencesDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ recorded: number; cleared: number }> {
    return await this.service.record(
      dto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  /**
   * Feuille d'appel d'une classe à une date : les élèves et leur statut sur
   * les deux demi-journées.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get('roster')
  async getRollCall(
    @Query('classRoomId') classRoomId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.service.getRollCall(
      resolveSchoolId(user, querySchoolId),
      classRoomId,
      academicYearId,
      date,
      user,
    );
  }

  /** Relecture de l'appel d'une classe à une date. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get()
  async findByDate(
    @Query('classRoomId') classRoomId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Absence[]> {
    return await this.service.findByClassRoomAndDate(
      resolveSchoolId(user, querySchoolId),
      classRoomId,
      academicYearId,
      date,
    );
  }

  /** Historique d'assiduité d'un élève sur son dossier. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get('enrollment/:enrollmentId')
  async findByEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Absence[]> {
    return await this.service.findByEnrollment(
      enrollmentId,
      resolveSchoolId(user, querySchoolId),
    );
  }

  /** Justification d'une absence a posteriori. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAbsenceDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Absence> {
    return await this.service.update(
      id,
      dto,
      resolveSchoolId(user, querySchoolId),
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    return await this.service.remove(id, resolveSchoolId(user, querySchoolId));
  }
}
