import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CsvService } from '../common/export/csv.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';
import { AuditLog } from './entities/audit-log.entity';
import { resolveSchoolId } from '../common/utils/resolve-school';

/**
 * Consultation du journal d'audit.
 *
 * Réservé à la direction : le journal dit qui a fait quoi, y compris sur les
 * comptes du personnel. Le secrétariat et la comptabilité n'ont pas à y
 * accéder — ce sont eux dont l'activité y est consignée.
 *
 * Aucune route d'écriture, de modification ou de suppression n'est exposée :
 * le journal s'alimente depuis les services métier, et rien ne permet d'y
 * revenir. Un journal qu'on peut retoucher ne prouve rien.
 */
@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly csvService: CsvService,
  ) {}

  private resolveSchool(user: AuthUser, querySchoolId?: string): string {
    const schoolId = resolveSchoolId(user, querySchoolId);
    return schoolId;
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get()
  async findAll(
    @Query() query: QueryAuditDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    return await this.auditService.findAll(
      this.resolveSchool(user, querySchoolId),
      query,
    );
  }

  /**
   * Export tableur du journal. Déclaré avant les routes paramétrées.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get('export')
  async export(
    @Query() query: QueryAuditDto,
    @Res() res: Response,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<void> {
    const schoolId = this.resolveSchool(user, querySchoolId);
    const entries = await this.auditService.findAllForExport(schoolId, query);

    const csv = this.csvService.build<AuditLog>(
      [
        { header: 'Date', value: (a) => a.createdAt },
        { header: 'Auteur', value: (a) => a.actorEmail },
        {
          header: 'Opération',
          value: (a) => AuditService.ACTION_LABELS[a.action] ?? a.action,
        },
        { header: 'Objet', value: (a) => a.entityType },
        { header: 'Détail', value: (a) => a.summary },
        {
          header: 'Valeurs modifiées',
          value: (a) => (a.changes ? JSON.stringify(a.changes) : ''),
        },
      ],
      entries,
    );

    const filename = this.csvService.filename(
      'journal-audit',
      user.slug ?? 'ECOLE',
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  /** Historique d'un objet précis : un dossier, un compte, une classe. */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Get(':entityType/:entityId')
  async findForEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<AuditLog[]> {
    return await this.auditService.findForEntity(
      this.resolveSchool(user, querySchoolId),
      entityType,
      entityId,
    );
  }
}
