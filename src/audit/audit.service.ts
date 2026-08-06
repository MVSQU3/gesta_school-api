import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import {
  AuditAction,
  AuditChange,
  AuditLog,
} from './entities/audit-log.entity';
import { QueryAuditDto } from './dto/query-audit.dto';

/** Ce qu'une opération transmet au journal. */
export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  changes?: Record<string, AuditChange> | null;
  /** `null` pour les opérations du super-administrateur sur les écoles. */
  schoolId?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /**
   * Écrit une ligne de journal.
   *
   * **N'échoue jamais bruyamment.** Si l'écriture du journal casse, l'opération
   * métier qui vient d'aboutir ne doit pas être annulée pour autant : refuser
   * une correction de tarif parce que la trace n'a pas pu être écrite serait
   * un remède pire que le mal. L'incident part dans les logs du serveur, où la
   * supervision le verra.
   *
   * L'appel n'est délibérément pas attendu par les services appelants : le
   * journal ne doit pas non plus ralentir la réponse.
   */
  async record(entry: AuditEntry, actor?: AuthUser | null): Promise<void> {
    try {
      const log = this.auditRepository.create({
        schoolId: entry.schoolId ?? actor?.schoolId ?? null,
        actorUserId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary.slice(0, 255),
        changes: entry.changes ?? null,
      });
      await this.auditRepository.save(log);
    } catch (error) {
      this.logger.error(
        `Écriture du journal d'audit impossible (${entry.action}) : ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Compare deux états et ne retient que ce qui a réellement changé.
   *
   * Sans ce filtre, enregistrer un formulaire sans rien toucher produirait une
   * ligne de journal listant tous les champs — et le jour où l'on cherche qui
   * a modifié le tarif, on remonterait dix entrées sans intérêt.
   */
  diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Record<string, AuditChange> | null {
    const changes: Record<string, AuditChange> = {};

    for (const key of Object.keys(after)) {
      const from = before[key];
      const to = after[key];
      if (to === undefined) continue;
      // Comparaison par valeur sérialisée : gère les dates et les tableaux de
      // rôles sans traitement particulier par type.
      if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
        changes[key] = { before: from ?? null, after: to };
      }
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  /**
   * Consultation du journal, du plus récent au plus ancien.
   *
   * Cloisonné par établissement comme le reste : un directeur ne voit que les
   * opérations de son école.
   */
  async findAll(
    schoolId: string,
    query: QueryAuditDto,
  ): Promise<PaginatedResult<AuditLog>> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const qb = this.auditRepository
      .createQueryBuilder('audit')
      .leftJoinAndSelect('audit.actorUser', 'actor')
      .where('audit.schoolId = :schoolId', { schoolId });

    if (query.action) {
      qb.andWhere('audit.action = :action', { action: query.action });
    }
    if (query.entityType) {
      qb.andWhere('audit.entityType = :entityType', {
        entityType: query.entityType,
      });
    }
    if (query.entityId) {
      qb.andWhere('audit.entityId = :entityId', { entityId: query.entityId });
    }
    if (query.actorUserId) {
      qb.andWhere('audit."actorUserId" = :actorUserId', {
        actorUserId: query.actorUserId,
      });
    }
    if (query.from || query.to) {
      const { start, end } = this.resolvePeriod(query.from, query.to);
      qb.andWhere('audit.createdAt BETWEEN :start AND :end', { start, end });
    }

    const [items, total] = await qb
      .orderBy('audit.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return buildPaginatedResult(items, total, page, limit);
  }

  /** Journal complet correspondant aux filtres, pour export tableur. */
  async findAllForExport(
    schoolId: string,
    query: QueryAuditDto,
  ): Promise<AuditLog[]> {
    const result = await this.findAll(schoolId, {
      ...query,
      page: 1,
      limit: 5000,
    });
    return result.items;
  }

  /** Bornes d'une période, la date de fin étant incluse en entier. */
  private resolvePeriod(
    from?: string,
    to?: string,
  ): { start: Date; end: Date } {
    const [fy, fm, fd] = (from ?? '2000-01-01').split('-').map(Number);
    const now = new Date();
    const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const [ty, tm, td] = (to ?? isoToday).split('-').map(Number);

    return {
      start: new Date(fy, fm - 1, fd, 0, 0, 0, 0),
      end: new Date(ty, tm - 1, td, 23, 59, 59, 999),
    };
  }

  /** Historique d'un objet précis, pour l'afficher à côté de sa fiche. */
  async findForEntity(
    schoolId: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditLog[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    return await this.auditRepository.find({
      where: { schoolId, entityType, entityId },
      relations: { actorUser: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Libellés lisibles des actions, pour l'affichage et l'export. */
  static readonly ACTION_LABELS: Record<AuditAction, string> = {
    [AuditAction.CLASSROOM_CREATED]: 'Classe créée',
    [AuditAction.CLASSROOM_UPDATED]: 'Classe modifiée',
    [AuditAction.CLASSROOM_DELETED]: 'Classe supprimée',
    [AuditAction.USER_CREATED]: 'Compte créé',
    [AuditAction.USER_UPDATED]: 'Compte modifié',
    [AuditAction.USER_STATUS_CHANGED]: 'Compte activé ou désactivé',
    [AuditAction.USER_PASSWORD_RESET]: 'Mot de passe réinitialisé',
    [AuditAction.USER_DELETED]: 'Compte supprimé',
    [AuditAction.ENROLLMENT_UPDATED]: 'Dossier corrigé',
    [AuditAction.ENROLLMENT_DELETED]: 'Dossier supprimé',
    [AuditAction.ENROLLMENT_RENEWED]: 'Dossier renouvelé',
    [AuditAction.ENROLLMENT_BULK_CREATED]: 'Réinscription en masse',
    [AuditAction.STUDENT_UPDATED]: 'Fiche élève corrigée',
    [AuditAction.ACADEMIC_YEAR_CREATED]: 'Année scolaire ouverte',
    [AuditAction.ACADEMIC_YEAR_UPDATED]: 'Année scolaire modifiée',
    [AuditAction.GRADING_PERIOD_UPDATED]: 'Période de notation modifiée',
    [AuditAction.SCHOOL_CREATED]: 'Établissement créé',
    [AuditAction.SCHOOL_UPDATED]: 'Établissement modifié',
    [AuditAction.SCHOOL_DELETED]: 'Établissement supprimé',
  };
}
