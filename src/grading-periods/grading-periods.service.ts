import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ): Promise<GradingPeriod> {
    const period = await this.findOneOfSchool(id, schoolId);
    Object.assign(period, dto);
    return await this.periodRepository.save(period);
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
