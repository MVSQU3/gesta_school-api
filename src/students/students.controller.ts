import { Controller, Get, Patch, Post, Body, UseGuards, Query, Param } from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentHistoryService } from './student-history.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { resolveSchoolId } from '../common/utils/resolve-school';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

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
    const schoolId = resolveSchoolId(user, querySchoolId);
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
    @Query('academicYearId') academicYearId?: string,
    @Query('schoolId') querySchoolId?: string,
  ) {
    const schoolId = resolveSchoolId(user, querySchoolId);
    return this.historyService.getHistory(studentId, schoolId, academicYearId);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
    return this.studentsService.search(schoolId, q ?? '');
  }

  @Roles(Role.DIRECTOR, Role.SECRETARY)
  @Get()
  findAll(
    @Query() pagination: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.studentsService.findAllBySchool(
      user.schoolId,
      academicYearId,
      pagination,
    );
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
