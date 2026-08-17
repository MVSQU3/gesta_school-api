import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BulletinsService } from '../bulletins/bulletins.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { Student } from '../students/entities/student.entity';
import {
  ApproveTransferDto,
  CreateTransferRequestDto,
  RejectTransferDto,
  SearchStudentDto,
} from './dto/transfer.dto';
import { TransferRequest, TransferStatus } from './entities/transfer-request.entity';

/** Durée d'accès par défaut, à l'acceptation. */
const DEFAULT_DURATION_DAYS = 30;

/** Élève trouvé dans un autre établissement — identité seule. */
export interface ForeignStudentMatch {
  studentId: string;
  firstName: string;
  lastName: string;
  birthDay: Date;
  school: { id: string; name: string };
  /** Demande déjà en cours ou accordée pour cet élève, s'il y en a une. */
  existingRequest: { id: string; status: TransferStatus } | null;
}

/** Résultat d'un élève sur une période, tel que transmis à l'école demandeuse. */
export interface SharedPeriodResult {
  period: string;
  average: number | null;
  rank: number | null;
  classSize: number;
  subjects: {
    name: string;
    coefficient: number;
    average: number | null;
    classAverage: number | null;
  }[];
}

/** Le dossier transmis : des bulletins, et rien d'autre. */
export interface SharedFile {
  student: { firstName: string; lastName: string; birthDay: Date };
  holdingSchool: string;
  expiresAt: Date | null;
  years: {
    label: string;
    className: string | null;
    periods: SharedPeriodResult[];
  }[];
}

/**
 * Transfert de dossier entre établissements.
 *
 * Un élève qui change d'école possède une fiche dans chacune : rien ne se
 * déplace, c'est le **droit de lire** qui se demande et s'accorde. L'école
 * détentrice décide, et peut couper l'accès à tout moment.
 *
 * Ce que l'école demandeuse obtient est volontairement étroit : les bulletins
 * par période, avec le détail par matière. Ni versements, ni soldes, ni
 * absences, ni coordonnées. Une école qui accueille un enfant a besoin de
 * savoir son niveau ; ce que sa famille devait à l'école précédente ne la
 * regarde pas, et l'exposer transformerait l'outil en fichier de mauvais
 * payeurs.
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(TransferRequest)
    private readonly requestRepository: Repository<TransferRequest>,
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(GradingPeriod)
    private readonly periodRepository: Repository<GradingPeriod>,
    private readonly bulletinsService: BulletinsService,
  ) {}

  /** Convertit la date locale JJ-MM-AAAA en Date JS/SQL. */
  private parseBirthDay(birthDay: string): Date {
    const [day, month, year] = birthDay.split(/[-/]/);
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  /**
   * Retrouve un élève dans les autres établissements.
   *
   * Le triplet nom + prénom + date de naissance doit correspondre exactement.
   * C'est ce qui distingue « je retrouve l'enfant que le parent m'a présenté »
   * de « je parcours les élèves des écoles voisines » : sans la date de
   * naissance, l'endpoint deviendrait un annuaire consultable par n'importe
   * quel directeur. Seule l'identité est retournée — aucune note ne sort ici.
   */
  async searchAcrossSchools(
    requestingSchoolId: string,
    dto: SearchStudentDto,
  ): Promise<ForeignStudentMatch[]> {
    const students = await this.studentRepository
      .createQueryBuilder('student')
      .innerJoinAndSelect('student.school', 'school')
      .where('student.schoolId != :requestingSchoolId', { requestingSchoolId })
      .andWhere('LOWER(TRIM(student.firstName)) = :firstName', {
        firstName: dto.firstName.trim().toLowerCase(),
      })
      .andWhere('LOWER(TRIM(student.lastName)) = :lastName', {
        lastName: dto.lastName.trim().toLowerCase(),
      })
      .andWhere('student.birthDay = :birthDay', {
        birthDay: this.parseBirthDay(dto.birthDay),
      })
      .getMany();

    if (students.length === 0) return [];

    // Les demandes déjà émises, pour que l'écran propose « demander » ou
    // « consulter » plutôt que de créer un doublon.
    const existing = await this.requestRepository.find({
      where: {
        requestingSchoolId,
        studentId: In(students.map((s) => s.id)),
        status: In([TransferStatus.PENDING, TransferStatus.APPROVED]),
      },
      order: { createdAt: 'DESC' },
    });

    return students.map((student) => {
      const request = existing.find((r) => r.studentId === student.id);
      return {
        studentId: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        birthDay: student.birthDay,
        school: { id: student.school.id, name: student.school.name },
        existingRequest: request
          ? { id: request.id, status: request.status }
          : null,
      };
    });
  }

  /**
   * Émet une demande de consultation.
   *
   * L'école détentrice est vérifiée contre la fiche plutôt que crue sur
   * parole : un `holdingSchoolId` fourni par l'appelant qui ne correspond pas
   * à l'élève enverrait la demande à une école qui ne détient rien, et son
   * directeur accorderait un accès sur un dossier qui n'est pas le sien.
   */
  async create(
    requestingSchoolId: string,
    userId: string,
    dto: CreateTransferRequestDto,
  ): Promise<TransferRequest> {
    const student = await this.studentRepository.findOne({
      where: { id: dto.studentId },
    });
    if (!student) {
      throw new NotFoundException(`Élève introuvable (${dto.studentId}).`);
    }
    if (student.schoolId !== dto.holdingSchoolId) {
      throw new BadRequestException(
        "L'établissement indiqué ne détient pas le dossier de cet élève.",
      );
    }
    if (student.schoolId === requestingSchoolId) {
      throw new BadRequestException(
        "Cet élève est déjà inscrit dans votre établissement : son dossier est consultable depuis l'espace Élèves.",
      );
    }

    const pending = await this.requestRepository.findOne({
      where: {
        requestingSchoolId,
        studentId: dto.studentId,
        status: In([TransferStatus.PENDING, TransferStatus.APPROVED]),
      },
    });
    if (pending) {
      throw new BadRequestException(
        pending.status === TransferStatus.PENDING
          ? 'Une demande est déjà en attente pour cet élève.'
          : 'Vous avez déjà accès au dossier de cet élève.',
      );
    }

    return await this.requestRepository.save(
      this.requestRepository.create({
        requestingSchoolId,
        holdingSchoolId: student.schoolId,
        studentId: student.id,
        requestedById: userId,
        reason: dto.reason,
        status: TransferStatus.PENDING,
      }),
    );
  }

  /** Demandes émises par l'établissement. */
  async findOutgoing(requestingSchoolId: string): Promise<TransferRequest[]> {
    return await this.requestRepository.find({
      where: { requestingSchoolId },
      relations: { student: true, holdingSchool: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** Demandes reçues par l'établissement, à instruire. */
  async findIncoming(holdingSchoolId: string): Promise<TransferRequest[]> {
    return await this.requestRepository.find({
      where: { holdingSchoolId },
      relations: { student: true, requestingSchool: true, requestedBy: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Charge une demande en vérifiant que l'établissement en est bien la partie
   * attendue. Le côté demandé décide ; le côté demandeur consulte.
   */
  private async loadFor(
    requestId: string,
    schoolId: string,
    side: 'holding' | 'requesting',
  ): Promise<TransferRequest> {
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
      relations: { student: true, holdingSchool: true, requestingSchool: true },
    });
    if (!request) {
      throw new NotFoundException(`Demande introuvable (${requestId}).`);
    }
    const owner =
      side === 'holding' ? request.holdingSchoolId : request.requestingSchoolId;
    if (owner !== schoolId) {
      // Même message et même code qu'une demande inexistante : distinguer les
      // deux permettrait de sonder l'existence des demandes des autres écoles.
      throw new NotFoundException(`Demande introuvable (${requestId}).`);
    }
    return request;
  }

  async approve(
    requestId: string,
    holdingSchoolId: string,
    userId: string,
    dto: ApproveTransferDto,
  ): Promise<TransferRequest> {
    const request = await this.loadFor(requestId, holdingSchoolId, 'holding');
    if (request.status !== TransferStatus.PENDING) {
      throw new BadRequestException(
        'Cette demande a déjà été traitée.',
      );
    }

    const days = dto.durationDays ?? DEFAULT_DURATION_DAYS;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    request.status = TransferStatus.APPROVED;
    request.decidedById = userId;
    request.decidedAt = new Date();
    request.expiresAt = expiresAt;
    return await this.requestRepository.save(request);
  }

  async reject(
    requestId: string,
    holdingSchoolId: string,
    userId: string,
    dto: RejectTransferDto,
  ): Promise<TransferRequest> {
    const request = await this.loadFor(requestId, holdingSchoolId, 'holding');
    if (request.status !== TransferStatus.PENDING) {
      throw new BadRequestException('Cette demande a déjà été traitée.');
    }

    request.status = TransferStatus.REJECTED;
    request.decisionReason = dto.reason;
    request.decidedById = userId;
    request.decidedAt = new Date();
    return await this.requestRepository.save(request);
  }

  /**
   * Coupe un accès déjà accordé.
   *
   * Une acceptation n'est pas définitive : c'est la contrepartie d'un accès
   * qui dure. Le motif est facultatif ici — une école n'a pas à se justifier
   * de reprendre ses propres données.
   */
  async revoke(
    requestId: string,
    holdingSchoolId: string,
    userId: string,
    reason?: string,
  ): Promise<TransferRequest> {
    const request = await this.loadFor(requestId, holdingSchoolId, 'holding');
    if (request.status !== TransferStatus.APPROVED) {
      throw new BadRequestException(
        "Seul un accès en cours peut être révoqué.",
      );
    }

    request.status = TransferStatus.REVOKED;
    request.decisionReason = reason ?? null;
    request.decidedById = userId;
    request.decidedAt = new Date();
    return await this.requestRepository.save(request);
  }

  /**
   * Le dossier partagé, en lecture seule.
   *
   * L'autorisation est revérifiée à chaque appel plutôt qu'à la première :
   * une révocation ou une expiration doit fermer l'accès immédiatement, y
   * compris pour un écran déjà ouvert.
   */
  async getSharedFile(
    requestId: string,
    requestingSchoolId: string,
  ): Promise<SharedFile> {
    const request = await this.loadFor(requestId, requestingSchoolId, 'requesting');

    if (request.status !== TransferStatus.APPROVED) {
      throw new ForbiddenException(
        request.status === TransferStatus.PENDING
          ? "Cette demande n'a pas encore été acceptée."
          : "L'accès à ce dossier a été refusé ou révoqué.",
      );
    }
    if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException(
        "L'accès à ce dossier a expiré. Émettez une nouvelle demande.",
      );
    }

    const enrollments = await this.enrollmentRepository.find({
      where: { studentId: request.studentId, schoolId: request.holdingSchoolId },
      relations: { classRoom: true, academicYear: true },
      order: { createdAt: 'DESC' },
    });

    const years: SharedFile['years'] = [];
    for (const enrollment of enrollments) {
      const periods = await this.periodRepository.find({
        where: {
          schoolId: request.holdingSchoolId,
          academicYearId: enrollment.academicYearId,
        },
        order: { sequence: 'ASC' },
      });

      const results: SharedPeriodResult[] = [];
      for (const period of periods) {
        try {
          const { bulletin } = await this.bulletinsService.getStudentBulletin(
            request.holdingSchoolId,
            enrollment.id,
            period.id,
          );
          // Une période sans aucune note n'est pas transmise : une ligne vide
          // dans un dossier reçu se lit comme un mauvais résultat.
          if (bulletin.average === null) continue;

          results.push({
            period: period.label,
            average: bulletin.average,
            rank: bulletin.rank,
            classSize: bulletin.classSize,
            subjects: bulletin.subjects.map((s) => ({
              name: s.name,
              coefficient: s.coefficient,
              average: s.average,
              classAverage: s.classAverage,
            })),
          });
        } catch {
          // Pas de bulletin calculable sur cette période : on l'omet.
        }
      }

      if (results.length > 0) {
        years.push({
          label: enrollment.academicYear?.label ?? '—',
          className: enrollment.classRoom?.name ?? null,
          periods: results,
        });
      }
    }

    return {
      student: {
        firstName: request.student.firstName,
        lastName: request.student.lastName,
        birthDay: request.student.birthDay,
      },
      holdingSchool: request.holdingSchool.name,
      expiresAt: request.expiresAt,
      years,
    };
  }
}
