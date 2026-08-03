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
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { PaginatedResult } from '../common/dto/pagination.dto';
import { BulkEnrollDto } from './dto/bulk-enroll.dto';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { QueryEnrollmentsDto } from './dto/query-enrollments.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { Enrollment } from './entities/enrollment.entity';
import { EnrollmentsService, EnrollmentWithBalance } from './enrollments.service';
import { AuthUser, CurrentUser } from 'src/common/decorators/current-user.decorator';

@Controller('api/v1/enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  /**
   * Saisie d'une nouvelle inscription au secrétariat et génération du jeton 72h
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Post()
  async create(
    @Body() createEnrollmentDto: CreateEnrollmentDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Enrollment> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    createEnrollmentDto.schoolId = schoolId;
    return await this.enrollmentsService.create(createEnrollmentDto, user.id);
  }


  /**
   * RÉINSCRIPTION EN MASSE
   * Ouvre un dossier pour chaque élève de la liste dans la classe d'accueil.
   * Les élèves déjà inscrits sur l'année sont écartés sans faire échouer le lot,
   * et le compte rendu dit lesquels.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Post('bulk')
  async bulkEnroll(
    @Body() dto: BulkEnrollDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.enrollmentsService.bulkEnroll(dto, schoolId, user.id);
  }

  /**
   * Liste paginée et filtrable des dossiers de l'école.
   * Filtres : statut, recherche libre (nom, prénom, référence, téléphone),
   * année scolaire, classe.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.ACCOUNTANT)
  @Get()
  async findAll(
    @Query() query: QueryEnrollmentsDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<PaginatedResult<Enrollment>> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN)
      ? querySchoolId
      : user.schoolId;
    if (!schoolId)
      throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.enrollmentsService.findAll(schoolId, query);
  }

  /**
   * Récupération de la liste des dossiers expirés pour l'onglet "Les Oubliés"
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Get('expired')
  async findExpired(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Enrollment[]> {
    if (user.roles.includes(Role.SUPER_ADMIN) && !querySchoolId) {
      return await this.enrollmentsService.findAllExpired();
    }
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école valide assignée.");
    return await this.enrollmentsService.findExpired(schoolId);
  }

  /**
   * LE CLONAGE FANTÔME 👻
   * Renouvellement d'un dossier expiré (Génération d'une nouvelle référence + reset 72h)
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Patch(':id/renew')
  async renew(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Enrollment> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé");
    return await this.enrollmentsService.renew(id, schoolId);
  }

  /**
   * Recherche d'un dossier par sa référence comptable (ex: INS-CMB-26-0001)
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.ACCOUNTANT)
  @Get('ref/:reference')
  async findByReference(
    @Param('reference') reference: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Enrollment> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé");
    return await this.enrollmentsService.findByReference(schoolId, reference);
  }

  /**
   * VALIDATION D'UNE INSCRIPTION
   * Passe le statut PENDING_PAYMENT → ENROLLED.
   * Réservé au directeur et à la secrétaire de l'école concernée.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Patch(':id/validate')
  async validate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Enrollment> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.enrollmentsService.validate(id, schoolId);
  }

  /**
   * CORRECTION D'UN DOSSIER
   * Changement de classe — erreur de saisie ou changement en cours d'année.
   * Le montant dû suit le tarif de la nouvelle classe, et le statut est
   * recalculé sur ce nouveau total.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<EnrollmentWithBalance> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.enrollmentsService.update(id, dto, schoolId);
  }

  /**
   * SUPPRESSION D'UN DOSSIER OUVERT PAR ERREUR
   * Refusée dès qu'un versement existe, même annulé : le dossier est alors une
   * pièce comptable. Réservée à la direction.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.enrollmentsService.remove(id, schoolId);
  }
}
