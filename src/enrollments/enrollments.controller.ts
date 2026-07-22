import {
  Body,
  Controller,
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
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { Enrollment } from './entities/enrollment.entity';
import { EnrollmentsService } from './enrollments.service';
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
    return await this.enrollmentsService.create(createEnrollmentDto);
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
}
