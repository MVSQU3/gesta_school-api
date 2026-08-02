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
  ): Promise<AcademicYear> {
    const year = await this.findOneOfSchool(id, schoolId);

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

    if (shouldActivate) {
      await this.activateExclusively(id, schoolId);
    }

    return await this.findOneOfSchool(id, schoolId);
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
