import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriodsService } from '../grading-periods/grading-periods.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { AcademicYear } from './entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class AcademicYearsService {
  constructor(
    @InjectRepository(AcademicYear)
    private readonly academicYearRepository: Repository<AcademicYear>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly gradingPeriodsService: GradingPeriodsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Rend une année active en désactivant toutes les autres de l'établissement.
   *
   * L'unicité est garantie dans une transaction : à aucun moment deux années
   * ne peuvent apparaître actives simultanément, ce qui rendrait indéterminée
   * la résolution de l'année par défaut à l'inscription.
   */
  private async activateExclusively(
    academicYearId: string,
    schoolId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        AcademicYear,
        { schoolId },
        { isActive: false },
      );
      await manager.update(
        AcademicYear,
        { id: academicYearId, schoolId },
        { isActive: true },
      );
    });
  }

  async create(
    createAcademicYearDto: CreateAcademicYearDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<AcademicYear> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const existing = await this.academicYearRepository.findOne({
      where: { schoolId, label: createAcademicYearDto.label },
    });
    if (existing) {
      throw new ConflictException(
        `L'année scolaire ${createAcademicYearDto.label} existe déjà pour cet établissement.`,
      );
    }

    const academicYear = this.academicYearRepository.create({
      ...createAcademicYearDto,
      schoolId,
    });
    const saved = await this.academicYearRepository.save(academicYear);

    if (saved.isActive) {
      await this.activateExclusively(saved.id, schoolId);
    }

    // Les périodes de notation (trimestres ou semestres selon l'établissement)
    // sont créées d'office : sans elles, aucune évaluation n'est saisissable.
    await this.gradingPeriodsService.generateForAcademicYear(saved.id, schoolId);

    /**
     * L'ouverture d'une année est l'acte fondateur de tout ce qui suit :
     * inscriptions, périodes de notation, bulletins. Elle clôture au passage
     * l'année précédente, ce que la phrase mentionne.
     */
    void this.auditService.record(
      {
        action: AuditAction.ACADEMIC_YEAR_CREATED,
        entityType: 'academic_years',
        entityId: saved.id,
        schoolId,
        summary:
          `Année scolaire ${saved.label} ouverte` +
          (saved.isActive ? ', activée — les autres sont clôturées' : ''),
      },
      actor,
    );

    return await this.findOneOfSchool(saved.id, schoolId);
  }

  /** Charge une année en vérifiant qu'elle appartient bien à l'école. */
  private async findOneOfSchool(
    id: string,
    schoolId: string,
  ): Promise<AcademicYear> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const year = await this.academicYearRepository.findOne({
      where: { id, schoolId },
    });
    if (!year) {
      throw new NotFoundException(
        `Année scolaire introuvable avec l'identifiant ${id}`,
      );
    }
    return year;
  }

  /**
   * Modification du libellé et/ou du statut actif.
   * Activer une année clôture automatiquement celle qui était en cours.
   */
  async update(
    id: string,
    updateDto: UpdateAcademicYearDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<AcademicYear> {
    const year = await this.findOneOfSchool(id, schoolId);
    const before = { label: year.label, isActive: year.isActive };

    if (updateDto.label && updateDto.label !== year.label) {
      const existing = await this.academicYearRepository.findOne({
        where: { schoolId, label: updateDto.label },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `L'année scolaire ${updateDto.label} existe déjà pour cet établissement.`,
        );
      }
      year.label = updateDto.label;
    }

    // Le statut actif passe par activateExclusively pour préserver l'unicité
    const shouldActivate = updateDto.isActive === true && !year.isActive;
    const shouldClose = updateDto.isActive === false;

    if (shouldClose) {
      year.isActive = false;
    }
    await this.academicYearRepository.save(year);

    /**
     * Clôturer l'année clôture ses périodes de notation.
     *
     * Sans cela, `isClosed` restait à la main de la direction, période par
     * période : un enseignant pouvait encore saisir des notes sur le dernier
     * trimestre d'une année terminée, et personne ne s'en apercevait avant
     * l'édition des bulletins.
     *
     * La réciproque n'est pas vraie : réactiver une année ne rouvre pas ses
     * périodes. Une période close l'a été pour une raison — la fin du
     * trimestre — que la réactivation de l'année ne remet pas en cause.
     */
    if (shouldClose) {
      await this.gradingPeriodsService.closeAllOfYear(id, schoolId);
    }

    if (shouldActivate) {
      await this.activateExclusively(id, schoolId);
    }

    const result = await this.findOneOfSchool(id, schoolId);

    // Le changement est décrit plutôt que constaté : « clôturée » et
    // « activée » n'ont pas les mêmes conséquences sur les inscriptions.
    const changes = this.auditService.diff(before, {
      label: result.label,
      isActive: result.isActive,
    });

    if (changes) {
      void this.auditService.record(
        {
          action: AuditAction.ACADEMIC_YEAR_UPDATED,
          entityType: 'academic_years',
          entityId: result.id,
          schoolId,
          summary: shouldClose
            ? `Année scolaire ${result.label} clôturée`
            : shouldActivate
              ? `Année scolaire ${result.label} activée — les autres sont clôturées`
              : `Année scolaire renommée en ${result.label}`,
          changes,
        },
        actor,
      );
    }

    return result;
  }

  /**
   * Suppression d'une année, refusée dès qu'une inscription y est rattachée.
   */
  async remove(id: string, schoolId: string): Promise<{ message: string }> {
    const year = await this.findOneOfSchool(id, schoolId);

    const enrollmentCount = await this.enrollmentRepository.count({
      where: { academicYearId: id },
    });

    if (enrollmentCount > 0) {
      throw new ConflictException(
        `L'année scolaire ${year.label} ne peut pas être supprimée : ${enrollmentCount} inscription(s) y sont rattachées. Vous pouvez la clôturer à la place.`,
      );
    }

    await this.academicYearRepository.remove(year);
    return { message: `L'année scolaire ${year.label} a été supprimée.` };
  }

  /**
   * Liste les années scolaires d'une école spécifique.
   * Utilisé par directeur, secrétaire et comptable.
   */
  async findAllBySchool(schoolId: string): Promise<AcademicYear[]> {
    return await this.academicYearRepository.find({
      where: { schoolId },
      order: { label: 'DESC' },
    });
  }

  /**
   * Liste toutes les années scolaires de toutes les écoles.
   * Réservé au SUPER_ADMIN.
   */
  async findAll(): Promise<AcademicYear[]> {
    return await this.academicYearRepository.find({
      order: { label: 'DESC' },
    });
  }
}
