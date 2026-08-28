import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Absence } from '../absences/entities/absence.entity';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import { PeriodSystem, School } from '../schools/entities/school.entity';
import { UpdateGradingPeriodDto } from './dto/update-grading-period.dto';
import { GradingPeriod } from './entities/grading-period.entity';

/** Libellés générés selon le découpage retenu par l'établissement. */
const PERIOD_LABELS: Record<PeriodSystem, string[]> = {
  [PeriodSystem.TRIMESTER]: ['1er Trimestre', '2e Trimestre', '3e Trimestre'],
  [PeriodSystem.SEMESTER]: ['1er Semestre', '2e Semestre'],
};

@Injectable()
export class GradingPeriodsService {
  constructor(
    @InjectRepository(GradingPeriod)
    private readonly periodRepository: Repository<GradingPeriod>,
    @InjectRepository(School)
    private readonly schoolRepository: Repository<School>,
    @InjectRepository(Evaluation)
    private readonly evaluationRepository: Repository<Evaluation>,
    @InjectRepository(Absence)
    private readonly absenceRepository: Repository<Absence>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Crée les périodes de notation d'une année scolaire, selon le découpage de
   * l'établissement : 3 trimestres ou 2 semestres.
   *
   * Appelé à l'ouverture d'une année scolaire. Idempotent : si des périodes
   * existent déjà pour cette année, rien n'est recréé.
   */
  async generateForAcademicYear(
    academicYearId: string,
    schoolId: string,
  ): Promise<GradingPeriod[]> {
    const existing = await this.periodRepository.find({
      where: { academicYearId },
      order: { sequence: 'ASC' },
    });
    if (existing.length > 0) return existing;

    const school = await this.schoolRepository.findOne({
      where: { id: schoolId },
    });
    const system = school?.periodSystem ?? PeriodSystem.TRIMESTER;

    const periods = PERIOD_LABELS[system].map((label, index) =>
      this.periodRepository.create({
        schoolId,
        academicYearId,
        label,
        sequence: index + 1,
      }),
    );

    return await this.periodRepository.save(periods);
  }

  /**
   * Recrée les périodes d'une année selon le découpage actuel de l'école.
   *
   * Sert après un passage trimestre ↔ semestre : les périodes sont générées à
   * l'ouverture de l'année, et changer le réglage ensuite ne les régénère pas.
   *
   * L'opération est refusée dès qu'une évaluation ou une absence se rattache à
   * l'une des périodes. Supprimer une période emporte en cascade les notes qui
   * en dépendent : une année entamée reste dans son découpage jusqu'à son
   * terme, et c'est la bonne réponse — on ne renumérote pas des trimestres en
   * semestres au milieu de l'année scolaire.
   */
  async regenerateForAcademicYear(
    academicYearId: string,
    schoolId: string,
  ): Promise<GradingPeriod[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const existing = await this.periodRepository.find({
      where: { schoolId, academicYearId },
    });

    if (existing.length > 0) {
      const periodIds = existing.map((p) => p.id);

      const evaluationCount = await this.evaluationRepository.count({
        where: { gradingPeriodId: In(periodIds) },
      });
      const absenceCount = await this.absenceRepository.count({
        where: { gradingPeriodId: In(periodIds) },
      });

      if (evaluationCount > 0 || absenceCount > 0) {
        const details = [
          evaluationCount > 0 ? `${evaluationCount} évaluation(s)` : null,
          absenceCount > 0 ? `${absenceCount} absence(s)` : null,
        ]
          .filter(Boolean)
          .join(' et ');

        throw new ConflictException(
          `Cette année scolaire est déjà entamée (${details} saisie(s)) : son découpage ne peut plus être modifié. ` +
            'Le nouveau découpage s’appliquera à la prochaine année ouverte.',
        );
      }

    }

    const school = await this.schoolRepository.findOne({
      where: { id: schoolId },
    });
    const system = school?.periodSystem ?? PeriodSystem.TRIMESTER;

    /**
     * Suppression et recréation dans une seule transaction.
     *
     * Enchaîner les deux écritures séparément laissait une fenêtre où l'année
     * n'avait plus aucune période : plus aucune note saisissable, et rien à
     * l'écran pour expliquer pourquoi. Le découpage change entièrement ou pas
     * du tout.
     */
    return await this.dataSource.transaction(async (manager) => {
      if (existing.length > 0) {
        await manager.remove(existing);
      }

      return await manager.save(
        PERIOD_LABELS[system].map((label, index) =>
          manager.create(GradingPeriod, {
            schoolId,
            academicYearId,
            label,
            sequence: index + 1,
          }),
        ),
      );
    });
  }

  /**
   * Clôture toutes les périodes d'une année, à la clôture de celle-ci.
   *
   * Une période déjà close n'est pas retouchée : l'écriture ne porte que sur
   * ce qui change, pour que la date de modification reste parlante.
   */
  async closeAllOfYear(
    academicYearId: string,
    schoolId: string,
  ): Promise<number> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const result = await this.periodRepository.update(
      { schoolId, academicYearId, isClosed: false },
      { isClosed: true },
    );

    return result.affected ?? 0;
  }

  async findAllByYear(
    schoolId: string,
    academicYearId: string,
  ): Promise<GradingPeriod[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    return await this.periodRepository.find({
      where: { schoolId, academicYearId },
      order: { sequence: 'ASC' },
    });
  }

  async findOneOfSchool(id: string, schoolId: string): Promise<GradingPeriod> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const period = await this.periodRepository.findOne({
      where: { id, schoolId },
    });
    if (!period) {
      throw new NotFoundException(
        `Période de notation introuvable avec l'identifiant ${id}`,
      );
    }
    return period;
  }

  /**
   * Renommage, ajustement des dates, ouverture ou clôture d'une période.
   * Une période close refuse toute nouvelle saisie de note.
   */
  async update(
    id: string,
    dto: UpdateGradingPeriodDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<GradingPeriod> {
    const period = await this.findOneOfSchool(id, schoolId);

    const before = {
      label: period.label,
      startDate: String(period.startDate ?? ''),
      endDate: String(period.endDate ?? ''),
      isClosed: period.isClosed,
    };

    // Seuls les champs réellement fournis sont recopiés.
    //
    // `Object.assign(period, dto)` écrasait les autres avec `undefined` : la
    // base n'en souffrait pas — TypeORM ignore les valeurs indéfinies — mais
    // l'objet renvoyé au client repartait sans son libellé ni ses dates, et
    // l'écran de gestion des périodes affichait une ligne vide après chaque
    // clôture.
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        (period as unknown as Record<string, unknown>)[key] = value;
      }
    }

    const saved = await this.periodRepository.save(period);

    const changes = this.auditService.diff(before, {
      label: saved.label,
      startDate: String(saved.startDate ?? ''),
      endDate: String(saved.endDate ?? ''),
      isClosed: saved.isClosed,
    });

    if (changes) {
      // La cloture est mise en avant : c'est elle qui fige les bulletins et
      // interdit toute saisie ulterieure de notes ou d'absences.
      const summary = changes.isClosed
        ? `Periode ${saved.label} ${saved.isClosed ? 'cloturee' : 'rouverte a la saisie'}`
        : `Periode ${saved.label} modifiee (${Object.keys(changes).join(', ')})`;

      void this.auditService.record(
        {
          action: AuditAction.GRADING_PERIOD_UPDATED,
          entityType: 'grading_periods',
          entityId: saved.id,
          schoolId,
          summary,
          changes,
        },
        actor,
      );
    }

    return saved;
  }

  /**
   * Suppression d'une période, refusée dès qu'elle porte des évaluations :
   * les notes déjà saisies seraient emportées.
   */
  async remove(id: string, schoolId: string): Promise<{ message: string }> {
    const period = await this.findOneOfSchool(id, schoolId);

    const evaluationCount = await this.evaluationRepository.count({
      where: { gradingPeriodId: id },
    });
    if (evaluationCount > 0) {
      throw new ConflictException(
        `La période ${period.label} ne peut pas être supprimée : ${evaluationCount} évaluation(s) y sont rattachées.`,
      );
    }

    await this.periodRepository.remove(period);
    return { message: `La période ${period.label} a été supprimée.` };
  }
}
