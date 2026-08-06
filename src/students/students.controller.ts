import { Controller, ForbiddenException, Get, Patch, Post, Body, UseGuards, Query, Param } from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentHistoryService } from './student-history.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/v1/students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly historyService: StudentHistoryService,
  ) {}

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Post()
  create(
    @Body() createStudentDto: CreateStudentDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN)
      ? querySchoolId
      : user.schoolId;
    if (!schoolId) {
      throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    }
    return this.studentsService.create(createStudentDto, schoolId);
  }

  /**
   * Dossier complet d'un élève : toutes ses années de scolarité, leur
   * situation financière, les versements reçus et les résultats par période.
   *
   * Déclarée avant `@Get(':studentId')`, sans quoi la route paramétrée
   * capturerait le segment `history`.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.ACCOUNTANT)
  @Get(':studentId/history')
  history(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN)
      ? querySchoolId
      : user.schoolId;
    if (!schoolId) {
      throw new ForbiddenException('Accès refusé : aucune école spécifiée.');
    }
    return this.historyService.getHistory(studentId, schoolId);
  }

  /**
   * Correction d'une fiche élève : faute d'orthographe sur le nom, date de
   * naissance erronée, numéro de parent qui a changé.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Patch(':studentId')
  update(
    @Param('studentId') studentId: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN)
      ? querySchoolId
      : user.schoolId;
    if (!schoolId) {
      throw new ForbiddenException('Accès refusé : aucune école spécifiée.');
    }
    return this.studentsService.update(studentId, dto, schoolId, user);
  }

  /**
   * Recherche d'un élève déjà enregistré, pour une réinscription.
   * Doit être déclarée avant `@Get(':studentId')` pour ne pas être capturée
   * par la route paramétrée.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Get('search')
  search(
    @Query('q') q: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN)
      ? querySchoolId
      : user.schoolId;
    if (!schoolId) {
      throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    }
    return this.studentsService.search(schoolId, q ?? '');
  }

  @Roles(Role.DIRECTOR, Role.SECRETARY)
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.studentsService.findAllBySchool(user.schoolId, academicYearId);
  }

  @Roles(Role.DIRECTOR, Role.SECRETARY)
  @Get(':studentId')
  findOneBySchool(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.studentsService.findOneBySchool(studentId, user.schoolId, academicYearId);
  }
}
