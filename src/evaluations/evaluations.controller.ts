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
  CreateEvaluationDto,
  SaveGradesDto,
  UpdateEvaluationDto,
} from './dto/evaluation.dto';
import { Evaluation } from './entities/evaluation.entity';
import { EvaluationsService } from './evaluations.service';

@Controller('api/v1/evaluations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EvaluationsController {
  constructor(private readonly service: EvaluationsService) {}

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('classRoomId') classRoomId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('gradingPeriodId') gradingPeriodId?: string,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Evaluation[]> {
    return await this.service.findAll(
      resolveSchoolId(user, querySchoolId),
      { classRoomId, subjectId, gradingPeriodId },
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.TEACHER)
  @Post()
  async create(
    @Body() dto: CreateEvaluationDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Evaluation> {
    return await this.service.create(
      dto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.TEACHER)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEvaluationDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Evaluation> {
    return await this.service.update(
      id,
      dto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.TEACHER)
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

  /**
   * Feuille de notes : la liste des élèves de la classe avec leur note
   * actuelle, prête à être saisie ou corrigée.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get(':id/grades')
  async getGradeSheet(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.service.getGradeSheet(
      id,
      resolveSchoolId(user, querySchoolId),
    );
  }

  /** Enregistrement de la feuille de notes complète. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.TEACHER)
  @Post(':id/grades')
  async saveGrades(
    @Param('id') id: string,
    @Body() dto: SaveGradesDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ saved: number }> {
    return await this.service.saveGrades(
      id,
      dto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }
}
