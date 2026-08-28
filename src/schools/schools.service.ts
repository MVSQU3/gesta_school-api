import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { PeriodSystem, School } from './entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';

/** Découpage tel qu'il se lit dans une phrase de journal. */
const LABELS: Record<PeriodSystem, string> = {
  [PeriodSystem.TRIMESTER]: '3 trimestres',
  [PeriodSystem.SEMESTER]: '2 semestres',
};

@Injectable()
export class SchoolsService {
  constructor(
    @InjectRepository(School)
    private readonly schoolRepository: Repository<School>,
    private readonly auditService: AuditService,
  ) {}

  async findAll(): Promise<School[]> {
    return await this.schoolRepository.find({
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<School> {
    const school = await this.schoolRepository.findOne({ where: { id } });
    if (!school) {
      throw new NotFoundException(
        `Établissement introuvable avec l'identifiant ${id}`,
      );
    }
    return school;
  }

  async update(id: string, updateSchoolDto: UpdateSchoolDto): Promise<School> {
    const school = await this.findOne(id);

    if (updateSchoolDto.slug && updateSchoolDto.slug.toUpperCase() !== school.slug) {
      const existing = await this.schoolRepository.findOne({
        where: { slug: updateSchoolDto.slug.toUpperCase() },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Un établissement avec le code ${updateSchoolDto.slug.toUpperCase()} existe déjà.`,
        );
      }
    }

    Object.assign(school, {
      ...updateSchoolDto,
      slug: updateSchoolDto.slug ? updateSchoolDto.slug.toUpperCase() : school.slug,
    });

    return await this.schoolRepository.save(school);
  }

  /**
   * Découpage de l'année scolaire — trimestres ou semestres.
   *
   * Ne touche pas aux années déjà ouvertes : les périodes sont générées à
   * l'ouverture, et les renuméroter au milieu d'une année emporterait les
   * notes qui s'y rattachent. La régénération se demande explicitement,
   * année par année, et n'est acceptée que sur une année vierge.
   */
  async updatePeriodSystem(
    schoolId: string,
    periodSystem: PeriodSystem,
    actor?: AuthUser,
  ): Promise<School> {
    const school = await this.findOne(schoolId);
    const before = school.periodSystem;

    if (before === periodSystem) return school;

    school.periodSystem = periodSystem;
    const saved = await this.schoolRepository.save(school);

    void this.auditService.record(
      {
        action: AuditAction.SCHOOL_UPDATED,
        entityType: 'schools',
        entityId: saved.id,
        schoolId: saved.id,
        summary:
          `Découpage de l'année scolaire : ${LABELS[before]} → ${LABELS[periodSystem]}`,
        changes: { periodSystem: { before, after: periodSystem } },
      },
      actor,
    );

    return saved;
  }

  async remove(
    id: string,
    actor?: AuthUser,
  ): Promise<{ message: string }> {
    const school = await this.findOne(id);
    const { id: schoolId, name, slug } = school;

    await this.schoolRepository.remove(school);

    /**
     * Émis après la suppression, et sans `schoolId` rattaché : l'établissement
     * n'existe plus, et la ligne serait emportée par la cascade qu'elle est
     * censée documenter. Le nom et le code restent dans la phrase.
     */
    void this.auditService.record(
      {
        action: AuditAction.SCHOOL_DELETED,
        entityType: 'schools',
        entityId: schoolId,
        schoolId: null,
        summary: `Établissement ${name} (${slug}) supprimé avec toutes ses données`,
      },
      actor,
    );

    return { message: `L'établissement ${name} a été supprimé avec succès.` };
  }
}
