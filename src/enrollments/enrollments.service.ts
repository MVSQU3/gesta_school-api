import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';
import {
  BalanceService,
  EnrollmentBalance,
} from '../common/balance/balance.service';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { ReferencesService } from '../common/counters/references.service';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { Payment } from '../payments/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { StudentsService } from '../students/students.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { QueryEnrollmentsDto } from './dto/query-enrollments.dto';
import { Enrollment, EnrollmentStatus } from './entities/enrollment.entity';

/** Inscription enrichie de sa situation financière. */
export interface EnrollmentWithBalance extends Enrollment {
  balanceInfo: EnrollmentBalance;
}

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(School)
    private readonly schoolRepository: Repository<School>,
    @InjectRepository(ClassRoom)
    private readonly classRoomRepository: Repository<ClassRoom>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepository: Repository<AcademicYear>,
    private readonly studentsService: StudentsService,
    private readonly referencesService: ReferencesService,
    private readonly balanceService: BalanceService,
  ) { }

  /**
   * Génère une référence séquentielle unique au format INS-CODE-YY-XXXX (ex: INS-CMB-26-0001).
   * La séquence est réservée en base de façon atomique : chaque appel — création
   * comme renouvellement — consomme un numéro qui ne sera jamais réattribué.
   */
  private async generateReference(schoolId: string): Promise<string> {
    const school = await this.schoolRepository.findOne({
      where: { id: schoolId },
    });
    const schoolSlug = school ? school.slug : 'SCH';

    return await this.referencesService.nextEnrollmentReference(
      schoolId,
      schoolSlug,
    );
  }

  /**
   * Calcule la date d'expiration exacte à 72 heures à partir de maintenant
   */
  private calculate72HoursExpiration(): Date {
    return new Date(Date.now() + 72 * 60 * 60 * 1000);
  }

  /**
   * Récupère une inscription complète avec toutes ses relations (Student, School, ClassRoom, AcademicYear)
   */
  async findOne(id: string): Promise<Enrollment> {
    const enrollment = await this.enrollmentRepository.findOne({
      where: { id },
      relations: {
        school: true,
        student: true,
        classRoom: true,
        academicYear: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Aucune inscription trouvée avec l'identifiant ${id}`,
      );
    }

    return enrollment;
  }

  /**
   * Crée une nouvelle inscription Multi-Tenant avec génération du Jeton Numérique 72h
   */
  async create(
    createEnrollmentDto: CreateEnrollmentDto,
    createdByUserId: string | null = null,
  ): Promise<Enrollment> {
    const schoolId = createEnrollmentDto.schoolId;
    let studentId = createEnrollmentDto.studentId;

    // Classe et année scolaire sont vérifiées EN PREMIER, avant toute écriture.
    // Les valider après la création de l'élève laissait un élève orphelin en
    // base à chaque tentative échouée.
    const classRoom = await this.classRoomRepository.findOne({
      where: {
        id: createEnrollmentDto.classRoomId,
        schoolId,
      },
    });

    if (!classRoom) {
      throw new NotFoundException(
        "La classe sélectionnée n'existe plus dans cet établissement. Rechargez la page pour actualiser la liste des classes.",
      );
    }

    const academicYear = await this.academicYearRepository.findOne({
      where: { id: createEnrollmentDto.academicYearId, schoolId },
    });

    if (!academicYear) {
      throw new NotFoundException(
        "L'année scolaire sélectionnée n'existe plus dans cet établissement. Rechargez la page pour actualiser la liste.",
      );
    }

    // Cas 1 : réinscription d'un élève déjà connu. On vérifie qu'il appartient
    // bien à l'établissement avant de lui rattacher un nouveau dossier.
    if (studentId) {
      const existing = await this.studentsService.findOneOfSchool(
        studentId,
        schoolId,
      );
      if (!existing) {
        throw new NotFoundException(
          `Aucun élève trouvé avec l'identifiant ${studentId} dans cet établissement.`,
        );
      }
    }

    // Cas 2 : nouvel élève. On refuse d'en créer un second exemplaire si le
    // même enfant est déjà enregistré — c'est ce qui faisait perdre son
    // historique d'une année sur l'autre.
    if (!studentId && createEnrollmentDto.studentData) {
      const { firstName, lastName, birthDay } = createEnrollmentDto.studentData;
      const duplicate = await this.studentsService.findDuplicate(
        schoolId,
        firstName,
        lastName,
        birthDay,
      );

      if (duplicate) {
        throw new ConflictException({
          message: `${duplicate.firstName} ${duplicate.lastName} (né(e) le ${new Date(duplicate.birthDay).toLocaleDateString('fr-FR')}) est déjà enregistré(e) dans cet établissement. Sélectionnez sa fiche existante pour le réinscrire, afin de conserver son historique.`,
          error: 'Conflict',
          statusCode: 409,
          // Permet au secrétariat de basculer directement sur la fiche existante
          existingStudent: {
            id: duplicate.id,
            firstName: duplicate.firstName,
            lastName: duplicate.lastName,
            birthDay: duplicate.birthDay,
            parentPhone: duplicate.parentPhone,
          },
        });
      }

      const newStudent = await this.studentsService.create(
        createEnrollmentDto.studentData,
        schoolId,
      );
      studentId = newStudent.id;
    }

    if (!studentId) {
      throw new BadRequestException(
        'Veuillez fournir un studentId ou les données studentData complètes pour enregistrer l’élève.',
      );
    }

    // Un élève ne peut pas avoir deux dossiers actifs sur la même année
    // scolaire. Un dossier expiré ne bloque pas : il se renouvelle depuis
    // « Les Oubliés ».
    const activeEnrollment = await this.enrollmentRepository.findOne({
      where: {
        studentId,
        academicYearId: createEnrollmentDto.academicYearId,
        schoolId,
        status: Not(EnrollmentStatus.EXPIRED),
      },
      relations: { academicYear: true },
    });

    if (activeEnrollment) {
      throw new ConflictException(
        `Cet élève possède déjà un dossier pour l'année ${activeEnrollment.academicYear?.label ?? 'sélectionnée'} (référence ${activeEnrollment.reference}).`,
      );
    }

    const reference = await this.generateReference(
      createEnrollmentDto.schoolId,
    );
    const expiresAt = this.calculate72HoursExpiration();

    const enrollment = this.enrollmentRepository.create({
      schoolId: createEnrollmentDto.schoolId,
      studentId,
      classRoomId: createEnrollmentDto.classRoomId,
      academicYearId: createEnrollmentDto.academicYearId,
      reference,
      status: EnrollmentStatus.PENDING_PAYMENT,
      expiresAt,
      totalDue: Number(classRoom.tuitionFee) || 0,
      createdByUserId,
    });

    const saved = await this.enrollmentRepository.save(enrollment);

    // Retourner l'inscription rechargée avec l'élève et ses coordonnées
    return await this.findOne(saved.id);
  }

  async findAllExpired(): Promise<Enrollment[]> {
    const now = new Date();
    const updateQuery: any = {
      status: EnrollmentStatus.PENDING_PAYMENT,
      expiresAt: LessThan(now),
    };
    await this.enrollmentRepository.update(updateQuery, {
      status: EnrollmentStatus.EXPIRED,
    });
    return await this.enrollmentRepository.find({
      where: { status: EnrollmentStatus.EXPIRED },
      relations: { school: true, student: true, classRoom: true, academicYear: true },
      order: { expiresAt: 'DESC' },
    });
  }

  /**
   * Récupère la liste de tous les dossiers expirés d'une école (Onglet "Les Oubliés")
   */
  async findExpired(schoolId: string): Promise<Enrollment[]> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const now = new Date();

    // Mettre à jour automatiquement en base les dossiers dépassés qui n'ont pas encore basculé
    const updateQuery: any = {
      status: EnrollmentStatus.PENDING_PAYMENT,
      expiresAt: LessThan(now),
      schoolId,
    };

    await this.enrollmentRepository.update(updateQuery, {
      status: EnrollmentStatus.EXPIRED,
    });

    const whereQuery: any = { status: EnrollmentStatus.EXPIRED, schoolId };

    return await this.enrollmentRepository.find({
      where: whereQuery,
      relations: {
        school: true,
        student: true,
        classRoom: true,
        academicYear: true,
      },
      order: { expiresAt: 'DESC' },
    });
  }

  /**
   * LE CLONAGE FANTÔME 👻
   * Écrase l'ancienne référence par une nouvelle (ex: INS-CMB-26-0002),
   * réinitialise le délai à +72h, et repasse le statut à PENDING_PAYMENT.
   */
  async renew(id: string, schoolId: string): Promise<Enrollment> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const enrollment = await this.findOne(id);

    if (enrollment.schoolId !== schoolId) {
      throw new BadRequestException(
        `Vous n'êtes pas autorisé à modifier cette inscription.`,
      );
    }

    const now = new Date();
    const isExpired =
      enrollment.status === EnrollmentStatus.EXPIRED ||
      enrollment.expiresAt < now;

    if (!isExpired) {
      throw new BadRequestException(
        `Le dossier ${enrollment.reference} est encore valide et ne nécessite pas de renouvellement.`,
      );
    }

    // Clonage fantôme Multi-Tenant: Nouvelle référence personnalisée + Reset 72h
    const newReference = await this.generateReference(enrollment.schoolId);
    const newExpiresAt = this.calculate72HoursExpiration();

    enrollment.reference = newReference;
    enrollment.expiresAt = newExpiresAt;
    enrollment.status = EnrollmentStatus.PENDING_PAYMENT;

    const saved = await this.enrollmentRepository.save(enrollment);

    return await this.findOne(saved.id);
  }

  /**
   * Liste paginée et filtrable des dossiers d'une école.
   *
   * Le montant déjà versé est agrégé par une sous-requête dans le SELECT :
   * une seule requête suffit, quel que soit le nombre de lignes retournées.
   */
  async findAll(
    schoolId: string,
    query: QueryEnrollmentsDto,
  ): Promise<PaginatedResult<EnrollmentWithBalance>> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .leftJoinAndSelect('enrollment.student', 'student')
      .leftJoinAndSelect('enrollment.classRoom', 'classRoom')
      .leftJoinAndSelect('enrollment.academicYear', 'academicYear')
      .leftJoinAndSelect('enrollment.school', 'school')
      .where('enrollment.schoolId = :schoolId', { schoolId });

    if (query.status) {
      qb.andWhere('enrollment.status = :status', { status: query.status });
    }
    if (query.academicYearId) {
      qb.andWhere('enrollment.academicYearId = :academicYearId', {
        academicYearId: query.academicYearId,
      });
    }
    if (query.classRoomId) {
      qb.andWhere('enrollment.classRoomId = :classRoomId', {
        classRoomId: query.classRoomId,
      });
    }
    if (query.search?.trim()) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(student."firstName") LIKE :search
          OR LOWER(student."lastName") LIKE :search
          OR LOWER(enrollment.reference) LIKE :search
          OR student."parentPhone" LIKE :search)`,
        { search },
      );
    }

    // Montant déjà versé, agrégé par sous-requête corrélée.
    // Les versements annulés sont exclus du déjà-versé.
    qb.addSelect(
      (sub) =>
        sub
          .select('COALESCE(SUM(payment.amount), 0)')
          .from(Payment, 'payment')
          .where('payment."enrollmentId" = enrollment.id')
          .andWhere('payment."cancelledAt" IS NULL'),
      'amountPaid',
    );

    qb.orderBy('enrollment.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [{ entities, raw }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);

    const items = entities.map((enrollment, index) => {
      const amountPaid = Number(raw[index]?.amountPaid ?? 0);
      const totalDue = Number(enrollment.totalDue) || 0;
      const result = enrollment as EnrollmentWithBalance;
      result.balanceInfo = {
        totalDue,
        amountPaid,
        balance: Math.max(totalDue - amountPaid, 0),
        isFullyPaid: totalDue > 0 && amountPaid >= totalDue,
        status: enrollment.status,
      };
      return result;
    });

    return buildPaginatedResult(items, total, page, limit);
  }

  /**
   * Recherche un dossier par sa référence comptable, enrichi de sa situation
   * financière (total dû, déjà versé, solde restant) afin que la caisse sache
   * quel montant réclamer avant d'encaisser.
   */
  async findByReference(
    schoolId: string,
    reference: string,
  ): Promise<EnrollmentWithBalance> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const school = await this.schoolRepository.findOne({
      where: { id: schoolId },
    });
    if (!school) {
      throw new NotFoundException(`Aucune école trouvée`);
    }

    const enrollment = await this.enrollmentRepository.findOne({
      where: { reference, schoolId },
      relations: {
        school: true,
        student: true,
        classRoom: true,
        academicYear: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Aucune inscription trouvée pour la référence ${reference}`,
      );
    }

    const result = enrollment as EnrollmentWithBalance;
    result.balanceInfo = await this.balanceService.compute(enrollment);
    return result;
  }

  /**
   * VALIDATION D'UNE INSCRIPTION
   * Passe le statut de PENDING_PAYMENT à ENROLLED.
   * Vérifie que l'inscription appartient à l'école du demandeur (multi-tenant).
   */
  async validate(id: string, schoolId: string): Promise<Enrollment> {
    if (!schoolId) {
      throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    }

    const enrollment = await this.findOne(id);

    if (enrollment.schoolId !== schoolId) {
      throw new (await import('@nestjs/common')).ForbiddenException(
        "Vous n'êtes pas autorisé à valider cette inscription.",
      );
    }

    if (enrollment.status === EnrollmentStatus.ENROLLED) {
      throw new BadRequestException(
        `L'inscription ${enrollment.reference} est déjà validée.`,
      );
    }

    if (enrollment.status === EnrollmentStatus.EXPIRED) {
      throw new BadRequestException(
        `L'inscription ${enrollment.reference} est expirée. Veuillez la renouveler avant de la valider.`,
      );
    }

    enrollment.status = EnrollmentStatus.ENROLLED;
    const saved = await this.enrollmentRepository.save(enrollment);
    return await this.findOne(saved.id);
  }
}
