import {
  Body,
  Controller,
  Delete,
  Get,
  Res,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CsvService } from '../common/export/csv.service';
import { ENROLLMENT_STATUS_LABELS } from './entities/enrollment.entity';
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
import { resolveSchoolId } from '../common/utils/resolve-school';

@Controller('api/v1/enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(
    private readonly enrollmentsService: EnrollmentsService,
    private readonly csvService: CsvService,
  ) {}

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
    const schoolId = resolveSchoolId(user, querySchoolId);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
    return await this.enrollmentsService.bulkEnroll(dto, schoolId, user.id, user);
  }


  /**
   * État des dossiers au format tableur, avec la situation financière de
   * chacun : c'est le document de relance des familles, et la base du
   * rapprochement comptable en fin de période.
   *
   * Les mêmes filtres que la liste s'appliquent — classe, année, statut,
   * recherche — mais sans pagination.
   *
   * Déclarée avant `@Get('expired')` et `@Get('ref/:reference')` pour rester
   * en amont de toute route paramétrée.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.ACCOUNTANT)
  @Get('export')
  async exportEnrollments(
    @Query() query: QueryEnrollmentsDto,
    @Res() res: Response,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<void> {
    const schoolId = resolveSchoolId(user, querySchoolId);

    const dossiers = await this.enrollmentsService.findAllForExport(schoolId, query);

    const csv = this.csvService.build(
      [
        { header: 'Référence', value: (e) => e.reference },
        { header: 'Nom', value: (e) => e.student?.lastName },
        { header: 'Prénom', value: (e) => e.student?.firstName },
        { header: 'Date de naissance', value: (e) => e.student?.birthDay ? new Date(e.student.birthDay).toLocaleDateString('fr-FR') : '' },
        { header: 'Téléphone parent', value: (e) => e.student?.parentPhone },
        { header: 'Classe', value: (e) => e.classRoom?.name },
        { header: 'Année scolaire', value: (e) => e.academicYear?.label },
        { header: 'Statut', value: (e) => ENROLLMENT_STATUS_LABELS[e.status] },
        { header: 'Total dû (FCFA)', value: (e) => e.balanceInfo.totalDue },
        { header: 'Versé (FCFA)', value: (e) => e.balanceInfo.amountPaid },
        { header: 'Reste à payer (FCFA)', value: (e) => e.balanceInfo.balance },
        { header: 'Date du dossier', value: (e) => e.createdAt },
        { header: "Échéance du jeton", value: (e) => e.expiresAt },
      ],
      dossiers,
    );

    const filename = this.csvService.filename('dossiers', user.slug ?? 'ECOLE');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
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
    @Query('academicYearId') academicYearId?: string,
  ): Promise<Enrollment[]> {
    if (user.roles.includes(Role.SUPER_ADMIN) && !querySchoolId) {
      return await this.enrollmentsService.findAllExpired();
    }
    const schoolId = resolveSchoolId(user, querySchoolId);
    return await this.enrollmentsService.findExpired(schoolId, academicYearId);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
    return await this.enrollmentsService.update(id, dto, schoolId, user);
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
    const schoolId = resolveSchoolId(user, querySchoolId);
    return await this.enrollmentsService.remove(id, schoolId, user);
  }
}
