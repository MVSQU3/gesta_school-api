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
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
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

  /**
   * Séances qu'un enseignant peut appeler à une date donnée.
   *
   * Déclarée avant les routes paramétrées. Le professeur choisit une date et
   * on lui propose ses cours de ce jour-là : sans cette liste, il devrait
   * deviner quel créneau viser.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.TEACHER)
  @Get('my-sessions')
  async mySessions(
    @Query('date') date: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.service.getMySessions(
      resolveSchoolId(user, querySchoolId),
      date,
      user,
    );
  }

  /**
   * Feuille d'appel d'une séance : les élèves de la classe et leur statut.
   *
   * La séance fixe la classe, la matière et le créneau ; la date reste
   * nécessaire, un même créneau revenant chaque semaine.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.TEACHER)
  @Get('roster')
  async getRollCall(
    @Query('scheduleEntryId') scheduleEntryId: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.service.getRollCall(
      resolveSchoolId(user, querySchoolId),
      scheduleEntryId,
      date,
      user,
    );
  }

  /**
   * Suivi de l'assiduité par matière et par classe — espace de la direction.
   *
   * Fermé aux enseignants : un professeur relève l'assiduité de ses propres
   * cours, il n'a pas à consulter celle de ses collègues.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get('overview')
  async overview(
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
    @Query('gradingPeriodId') gradingPeriodId?: string,
    @Query('classRoomId') classRoomId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.service.getOverview(
      resolveSchoolId(user, querySchoolId),
      { academicYearId, gradingPeriodId, classRoomId, subjectId },
    );
  }

  /**
   * Élèves dépassant un seuil d'absences non justifiées.
   *
   * Le seuil est fourni par l'appelant : ce qui alerte en terminale n'alerte
   * pas en sixième, et l'établissement seul sait où il place la limite.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get('at-risk')
  async atRisk(
    @CurrentUser() user: AuthUser,
    @Query('threshold') threshold?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('gradingPeriodId') gradingPeriodId?: string,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.service.getAtRisk(
      resolveSchoolId(user, querySchoolId),
      Number(threshold) || 5,
      { academicYearId, gradingPeriodId },
    );
  }

  /**
   * Appel d'une séance.
   *
   * Réservé à l'enseignant du créneau et à la direction : l'appel se constate
   * en cours. Le secrétariat garde la consultation par élève, mais ne
   * constate pas lui-même.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.TEACHER)
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

  /** Correction d'une ligne : statut, justification, motif. */
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
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    return await this.service.remove(
      id,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }
}
