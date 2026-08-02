import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { ClassRoomSubject } from '../subjects/entities/classroom-subject.entity';
import { TeachingService } from '../teaching/teaching.service';
import {
  CreateEvaluationDto,
  SaveGradesDto,
  UpdateEvaluationDto,
} from './dto/evaluation.dto';
import { Evaluation, EvaluationType } from './entities/evaluation.entity';
import { Grade } from './entities/grade.entity';

@Injectable()
export class EvaluationsService {
  constructor(
    @InjectRepository(Evaluation)
    private readonly evaluationRepository: Repository<Evaluation>,
    @InjectRepository(Grade)
    private readonly gradeRepository: Repository<Grade>,
    @InjectRepository(GradingPeriod)
    private readonly periodRepository: Repository<GradingPeriod>,
    @InjectRepository(ClassRoomSubject)
    private readonly programRepository: Repository<ClassRoomSubject>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    private readonly teachingService: TeachingService,
  ) {}

  /**
   * Un enseignant ne peut agir que sur les matières et classes qui lui sont
   * affectées. Direction et administration ne sont pas soumises à ce contrôle.
   */
  private async assertCanTeach(
    user: AuthUser,
    classRoomId: string,
    subjectId: string,
    academicYearId: string,
  ): Promise<void> {
    const isStaff = user.roles.some((r) =>
      [Role.SUPER_ADMIN, Role.DIRECTOR].includes(r),
    );
    if (isStaff) return;

    const assigned = await this.teachingService.isAssigned(
      user.id,
      classRoomId,
      subjectId,
      academicYearId,
    );
    if (!assigned) {
      throw new ForbiddenException(
        "Vous n'êtes pas affecté à cette matière dans cette classe.",
      );
    }
  }

  /** Le barème doit rester cohérent avec le type d'évaluation. */
  private resolveMaxScore(type: EvaluationType, maxScore?: number): number {
    if (type === EvaluationType.DEVOIR) {
      if (maxScore && maxScore !== 20) {
        throw new BadRequestException('Un devoir est toujours noté sur 20.');
      }
      return 20;
    }
    return maxScore ?? 20;
  }

  async create(
    dto: CreateEvaluationDto,
    schoolId: string,
    user: AuthUser,
  ): Promise<Evaluation> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const period = await this.periodRepository.findOne({
      where: { id: dto.gradingPeriodId, schoolId },
    });
    if (!period) {
      throw new NotFoundException('Période de notation introuvable.');
    }
    if (period.isClosed) {
      throw new ConflictException(
        `La période ${period.label} est clôturée : aucune nouvelle évaluation ne peut y être ajoutée.`,
      );
    }

    // La matière doit figurer au programme de la classe, sinon elle n'a ni
    // coefficient ni place sur le bulletin.
    const program = await this.programRepository.findOne({
      where: { classRoomId: dto.classRoomId, subjectId: dto.subjectId, schoolId },
    });
    if (!program) {
      throw new ConflictException(
        "Cette matière ne figure pas au programme de la classe. Ajoutez-la d'abord, avec son coefficient.",
      );
    }

    await this.assertCanTeach(
      user,
      dto.classRoomId,
      dto.subjectId,
      period.academicYearId,
    );

    const evaluation = this.evaluationRepository.create({
      ...dto,
      schoolId,
      date: new Date(dto.date),
      maxScore: this.resolveMaxScore(dto.type, dto.maxScore),
      weight: dto.weight ?? 1,
      createdByUserId: user.id,
    });

    const saved = await this.evaluationRepository.save(evaluation);
    return await this.findOneOfSchool(saved.id, schoolId);
  }

  async findOneOfSchool(id: string, schoolId: string): Promise<Evaluation> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const evaluation = await this.evaluationRepository.findOne({
      where: { id, schoolId },
      relations: { subject: true, classRoom: true, gradingPeriod: true },
    });
    if (!evaluation) {
      throw new NotFoundException(`Évaluation introuvable (${id})`);
    }
    return evaluation;
  }

  async findAll(
    schoolId: string,
    filters: {
      classRoomId?: string;
      subjectId?: string;
      gradingPeriodId?: string;
    },
    user: AuthUser,
  ): Promise<Evaluation[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const qb = this.evaluationRepository
      .createQueryBuilder('evaluation')
      .leftJoinAndSelect('evaluation.subject', 'subject')
      .leftJoinAndSelect('evaluation.classRoom', 'classRoom')
      .leftJoinAndSelect('evaluation.gradingPeriod', 'gradingPeriod')
      .where('evaluation.schoolId = :schoolId', { schoolId });

    if (filters.classRoomId) {
      qb.andWhere('evaluation.classRoomId = :classRoomId', filters);
    }
    if (filters.subjectId) {
      qb.andWhere('evaluation.subjectId = :subjectId', filters);
    }
    if (filters.gradingPeriodId) {
      qb.andWhere('evaluation.gradingPeriodId = :gradingPeriodId', filters);
    }

    // Un enseignant ne voit que les évaluations de ses propres affectations.
    const isStaff = user.roles.some((r) =>
      [Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY].includes(r),
    );
    if (!isStaff) {
      // Les alias sont quotés : sans guillemets, PostgreSQL les replie en
      // minuscules et ne retrouve plus « gradingPeriod » ni « evaluation ».
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM teaching_assignments ta
            WHERE ta."teacherId" = :teacherId
              AND ta."classRoomId" = "evaluation"."classRoomId"
              AND ta."subjectId" = "evaluation"."subjectId"
              AND ta."academicYearId" = "gradingPeriod"."academicYearId"
         )`,
        { teacherId: user.id },
      );
    }

    return await qb
      .orderBy('evaluation.date', 'DESC')
      .addOrderBy('evaluation.createdAt', 'DESC')
      .getMany();
  }

  async update(
    id: string,
    dto: UpdateEvaluationDto,
    schoolId: string,
    user: AuthUser,
  ): Promise<Evaluation> {
    const evaluation = await this.findOneOfSchool(id, schoolId);
    if (evaluation.gradingPeriod.isClosed) {
      throw new ConflictException(
        `La période ${evaluation.gradingPeriod.label} est clôturée.`,
      );
    }
    await this.assertCanTeach(
      user,
      evaluation.classRoomId,
      evaluation.subjectId,
      evaluation.gradingPeriod.academicYearId,
    );

    if (dto.title) evaluation.title = dto.title;
    if (dto.date) evaluation.date = new Date(dto.date);
    if (dto.weight !== undefined) evaluation.weight = dto.weight;
    if (dto.type || dto.maxScore) {
      const type = dto.type ?? evaluation.type;
      evaluation.type = type;
      evaluation.maxScore = this.resolveMaxScore(type, dto.maxScore);
    }

    await this.evaluationRepository.save(evaluation);
    return await this.findOneOfSchool(id, schoolId);
  }

  async remove(
    id: string,
    schoolId: string,
    user: AuthUser,
  ): Promise<{ message: string }> {
    const evaluation = await this.findOneOfSchool(id, schoolId);
    if (evaluation.gradingPeriod.isClosed) {
      throw new ConflictException(
        `La période ${evaluation.gradingPeriod.label} est clôturée.`,
      );
    }
    await this.assertCanTeach(
      user,
      evaluation.classRoomId,
      evaluation.subjectId,
      evaluation.gradingPeriod.academicYearId,
    );

    await this.evaluationRepository.remove(evaluation);
    return { message: `L'évaluation « ${evaluation.title} » a été supprimée.` };
  }

  /**
   * Feuille de notes : tous les élèves inscrits dans la classe pour l'année de
   * la période, avec leur note si elle est déjà saisie.
   *
   * Les dossiers expirés sont exclus : ce sont des inscriptions abandonnées.
   */
  async getGradeSheet(evaluationId: string, schoolId: string) {
    const evaluation = await this.findOneOfSchool(evaluationId, schoolId);

    const enrollments = await this.enrollmentRepository.find({
      where: {
        schoolId,
        classRoomId: evaluation.classRoomId,
        academicYearId: evaluation.gradingPeriod.academicYearId,
        status: In([
          EnrollmentStatus.PENDING_PAYMENT,
          EnrollmentStatus.PARTIALLY_PAID,
          EnrollmentStatus.ENROLLED,
        ]),
      },
      relations: { student: true },
    });

    const grades = await this.gradeRepository.find({
      where: { evaluationId },
    });
    const byEnrollment = new Map(grades.map((g) => [g.enrollmentId, g]));

    const rows = enrollments
      .map((enrollment) => {
        const grade = byEnrollment.get(enrollment.id);
        return {
          enrollmentId: enrollment.id,
          studentId: enrollment.studentId,
          firstName: enrollment.student?.firstName ?? '',
          lastName: enrollment.student?.lastName ?? '',
          score: grade?.score ?? null,
          isAbsent: grade?.isAbsent ?? false,
          comment: grade?.comment ?? null,
        };
      })
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      );

    return { evaluation, students: rows };
  }

  /**
   * Enregistre une feuille de notes complète.
   *
   * Chaque note est vérifiée contre le barème de l'évaluation et contre
   * l'appartenance de l'inscription à la classe : on ne peut pas glisser la
   * note d'un élève d'une autre classe.
   */
  async saveGrades(
    evaluationId: string,
    dto: SaveGradesDto,
    schoolId: string,
    user: AuthUser,
  ): Promise<{ saved: number }> {
    const evaluation = await this.findOneOfSchool(evaluationId, schoolId);

    if (evaluation.gradingPeriod.isClosed) {
      throw new ConflictException(
        `La période ${evaluation.gradingPeriod.label} est clôturée : les notes ne sont plus modifiables.`,
      );
    }
    await this.assertCanTeach(
      user,
      evaluation.classRoomId,
      evaluation.subjectId,
      evaluation.gradingPeriod.academicYearId,
    );

    const enrollmentIds = dto.grades.map((g) => g.enrollmentId);
    if (enrollmentIds.length === 0) return { saved: 0 };

    const validEnrollments = await this.enrollmentRepository.find({
      where: {
        id: In(enrollmentIds),
        schoolId,
        classRoomId: evaluation.classRoomId,
        academicYearId: evaluation.gradingPeriod.academicYearId,
      },
      select: { id: true },
    });
    const validIds = new Set(validEnrollments.map((e) => e.id));

    const rejected = enrollmentIds.filter((id) => !validIds.has(id));
    if (rejected.length > 0) {
      throw new BadRequestException(
        `${rejected.length} élève(s) ne sont pas inscrits dans cette classe pour cette année scolaire.`,
      );
    }

    for (const entry of dto.grades) {
      if (!entry.isAbsent && entry.score !== null && entry.score !== undefined) {
        if (entry.score > evaluation.maxScore) {
          throw new BadRequestException(
            `Une note de ${entry.score} dépasse le barème de l'évaluation (sur ${evaluation.maxScore}).`,
          );
        }
      }
    }

    const existing = await this.gradeRepository.find({
      where: { evaluationId },
    });
    const byEnrollment = new Map(existing.map((g) => [g.enrollmentId, g]));

    const toSave = dto.grades.map((entry) => {
      const isAbsent = entry.isAbsent ?? false;
      const current = byEnrollment.get(entry.enrollmentId);
      const payload = {
        schoolId,
        evaluationId,
        enrollmentId: entry.enrollmentId,
        // Une absence neutralise la note : elle ne compte pas comme un zéro
        score: isAbsent ? null : (entry.score ?? null),
        isAbsent,
        comment: entry.comment?.trim() || null,
        recordedByUserId: user.id,
      };
      return current
        ? this.gradeRepository.merge(current, payload)
        : this.gradeRepository.create(payload);
    });

    await this.gradeRepository.save(toSave);
    return { saved: toSave.length };
  }
}
