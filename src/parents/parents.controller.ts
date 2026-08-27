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
import { CreateParentDto } from './dto/create-parent.dto';
import { LinkChildDto } from './dto/link-child.dto';
import { ParentsService } from './parents.service';

/**
 * Deux familles de routes cohabitent ici, avec deux régimes d'autorisation
 * distincts :
 *
 *  - `/api/v1/parents/...` — administration des comptes par le secrétariat.
 *    Portée : l'établissement, résolue par `resolveSchoolId()` comme partout
 *    ailleurs.
 *
 *  - `/api/v1/parents/me/...` — l'espace du parent connecté. Portée : les
 *    seuls élèves qui lui sont rattachés. Le `schoolId` n'y suffit jamais ;
 *    c'est `assertGuardianOf()`, dans le service, qui autorise.
 *
 * Les routes `me/` sont déclarées avant les routes paramétrées : sans cela
 * `me` serait capté par `:id`.
 */
@Controller('api/v1/parents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}

  // ------------------------------------------------------------------
  // Espace parent
  // ------------------------------------------------------------------

  /**
   * Années scolaires consultables — celles où un enfant a été inscrit.
   * Alimente le sélecteur d'année de l'espace parent.
   */
  @Roles(Role.PARENT)
  @Get('me/years')
  async myYears(@CurrentUser() user: AuthUser) {
    return await this.parentsService.getMyYears(
      user.id,
      this.parentsService.requireParentSchool(user),
    );
  }

  /**
   * Mes enfants, avec le dossier et le solde de chacun.
   * Sans `academicYearId`, le dossier le plus récent de chaque enfant.
   */
  @Roles(Role.PARENT)
  @Get('me/children')
  async myChildren(
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return await this.parentsService.getMyChildren(
      user.id,
      this.parentsService.requireParentSchool(user),
      academicYearId,
    );
  }

  /** Situation financière d'un dossier : solde et versements. */
  @Roles(Role.PARENT)
  @Get('me/enrollments/:enrollmentId/finance')
  async myChildFinance(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return await this.parentsService.getChildFinance(
      user.id,
      enrollmentId,
      this.parentsService.requireParentSchool(user),
    );
  }

  /** Périodes de notation de l'année de l'enfant. */
  @Roles(Role.PARENT)
  @Get('me/enrollments/:enrollmentId/periods')
  async myChildPeriods(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return await this.parentsService.getChildPeriods(
      user.id,
      enrollmentId,
      this.parentsService.requireParentSchool(user),
    );
  }

  /** Bulletin d'un enfant sur une période de notation. */
  @Roles(Role.PARENT)
  @Get('me/enrollments/:enrollmentId/bulletin')
  async myChildBulletin(
    @Param('enrollmentId') enrollmentId: string,
    @Query('gradingPeriodId') gradingPeriodId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return await this.parentsService.getChildBulletin(
      user.id,
      enrollmentId,
      gradingPeriodId,
      this.parentsService.requireParentSchool(user),
    );
  }

  /** Notes individuelles d'un enfant sur une période, groupées par matière. */
  @Roles(Role.PARENT)
  @Get('me/enrollments/:enrollmentId/grades')
  async myChildGrades(
    @Param('enrollmentId') enrollmentId: string,
    @Query('gradingPeriodId') gradingPeriodId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return await this.parentsService.getChildGrades(
      user.id,
      enrollmentId,
      gradingPeriodId,
      this.parentsService.requireParentSchool(user),
    );
  }

  /** Absences et retards d'un enfant. */
  @Roles(Role.PARENT)
  @Get('me/enrollments/:enrollmentId/absences')
  async myChildAbsences(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return await this.parentsService.getChildAbsences(
      user.id,
      enrollmentId,
      this.parentsService.requireParentSchool(user),
    );
  }

  // ------------------------------------------------------------------
  // Administration des comptes — secrétariat et direction
  // ------------------------------------------------------------------

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Post()
  async create(
    @Body() dto: CreateParentDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.parentsService.createParent(
      dto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.parentsService.findAllOfSchool(
      resolveSchoolId(user, querySchoolId),
      search,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.parentsService.findOneSummary(
      id,
      resolveSchoolId(user, querySchoolId),
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Post(':id/children')
  async linkChild(
    @Param('id') id: string,
    @Body() dto: LinkChildDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.parentsService.linkChild(
      id,
      dto,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Delete(':id/children/:studentId')
  async unlinkChild(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.parentsService.unlinkChild(
      id,
      studentId,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  /**
   * Réinitialisation du mot de passe. Réservée à la direction : c'est la
   * remise d'un accès aux données d'un élève, pas une opération de guichet.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id/password')
  async resetPassword(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.parentsService.resetPassword(
      id,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id/status')
  async setActive(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.parentsService.setActive(
      id,
      isActive,
      resolveSchoolId(user, querySchoolId),
      user,
    );
  }
}
