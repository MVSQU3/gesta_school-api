import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, LessThan, Not, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';
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
import { BulkEnrollDto } from './dto/bulk-enroll.dto';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { QueryEnrollmentsDto } from './dto/query-enrollments.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { Enrollment, EnrollmentStatus } from './entities/enrollment.entity';

/** Inscription enrichie de sa situation financière. */
export interface EnrollmentWithBalance extends Enrollment {
  balanceInfo: EnrollmentBalance;
  /**
   * Impayés du même élève sur les années précédentes.
   *
   * Signalés, jamais reportés : ajouter d'office la dette de l'an dernier au
   * dossier de cette année mélangerait deux exercices comptables et fausserait
   * le journal de caisse des deux. Le guichet voit l'ardoise et décide — c'est
   * une négociation avec la famille, pas un calcul.
   */
  previousDebts?: Array<{
    reference: string;
    academicYearLabel: string;
    balance: number;
  }>;
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
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly studentsService: StudentsService,
    private readonly referencesService: ReferencesService,
    private readonly balanceService: BalanceService,
    private readonly auditService: AuditService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) { }

  /**
   * Génère une référence séquentielle unique au format INS-CODE-YY-XXXX (ex: INS-CMB-26-0001).
   * La séquence est réservée en base de façon atomique : chaque appel — création
   * comme renouvellement — consomme un numéro qui ne sera jamais réattribué.
   */
  private async generateReference(
    schoolId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const school = await this.schoolRepository.findOne({
      where: { id: schoolId },
    });
    const schoolSlug = school ? school.slug : 'SCH';

    return await this.referencesService.nextEnrollmentReference(
      schoolId,
      schoolSlug,
      manager,
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
    outerManager?: EntityManager,
  ): Promise<Enrollment> {
    const schoolId = createEnrollmentDto.schoolId;
    const studentId = createEnrollmentDto.studentId;
    /** Fiche à créer dans la transaction, quand l'élève est nouveau. */
    let pendingStudentData: CreateEnrollmentDto['studentData'] | undefined;

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

    /**
     * Une année close n'accepte plus d'inscription.
     *
     * L'identifiant vient du client : un onglet resté ouvert pendant la
     * rentrée porte encore celui de l'année précédente, et le dossier créé
     * partait alors dans une année terminée — invisible du tableau de bord,
     * absent des listes de classe, mais bien facturé à la famille.
     *
     * Conséquence assumée : pour inscrire sur l'année suivante, il faut
     * l'avoir activée. C'est déjà le déroulé normal d'une rentrée, la
     * création d'une année l'activant par défaut.
     */
    if (!academicYear.isActive) {
      throw new ConflictException(
        `L'année scolaire ${academicYear.label} est clôturée : aucune nouvelle inscription ne peut y être enregistrée. Activez l'année en cours depuis l'espace Direction.`,
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

      // La fiche est créée dans la même transaction que le dossier : voir
      // le commentaire du bloc transactionnel plus bas.
      pendingStudentData = createEnrollmentDto.studentData;
    }

    if (!studentId && !pendingStudentData) {
      throw new BadRequestException(
        'Veuillez fournir un studentId ou les données studentData complètes pour enregistrer l’élève.',
      );
    }

    // Un élève ne peut pas avoir deux dossiers actifs sur la même année
    // scolaire. Un dossier expiré ne bloque pas : il se renouvelle depuis
    // « Les Oubliés ».
    const activeEnrollment = studentId
      ? await this.enrollmentRepository.findOne({
      where: {
        studentId,
        academicYearId: createEnrollmentDto.academicYearId,
        schoolId,
        status: Not(EnrollmentStatus.EXPIRED),
      },
      relations: { academicYear: true },
        })
      : null;

    if (activeEnrollment) {
      throw new ConflictException(
        `Cet élève possède déjà un dossier pour l'année ${activeEnrollment.academicYear?.label ?? 'sélectionnée'} (référence ${activeEnrollment.reference}).`,
      );
    }

    const expiresAt = this.calculate72HoursExpiration();

    /**
     * Fiche élève, numéro de référence et dossier dans une seule transaction.
     *
     * Enchaînés séparément, un échec sur le dossier laissait derrière lui une
     * fiche élève orpheline — que la recherche de doublons proposerait ensuite
     * comme un élève déjà inscrit — et une référence consommée pour rien dans
     * le compteur, créant un trou dans la numérotation comptable.
     *
     * `run` permet à la réinscription en masse de fournir sa propre
     * transaction, pour que le lot entier soit atomique.
     */
    const run = async (manager: EntityManager) => {
      const resolvedStudentId = pendingStudentData
        ? (
            await this.studentsService.create(
              pendingStudentData,
              schoolId,
              manager,
            )
          ).id
        : (studentId as string);

      const reference = await this.generateReference(
        createEnrollmentDto.schoolId,
        manager,
      );

      const enrollment = manager.create(Enrollment, {
        schoolId: createEnrollmentDto.schoolId,
        studentId: resolvedStudentId,
        classRoomId: createEnrollmentDto.classRoomId,
        academicYearId: createEnrollmentDto.academicYearId,
        reference,
        status: EnrollmentStatus.PENDING_PAYMENT,
        expiresAt,
        totalDue: Number(classRoom.tuitionFee) || 0,
        createdByUserId,
      });

      return await manager.save(enrollment);
    };

    const saved = outerManager
      ? await run(outerManager)
      : await this.dataSource.transaction(run);

    // Retourner l'inscription rechargée avec l'élève et ses coordonnées
    return await this.findOne(saved.id);
  }

  /**
   * Réinscription en masse : un dossier par élève de la liste, dans la même
   * classe et la même année.
   *
   * Chaque élève est traité indépendamment, et non dans une transaction
   * unique. C'est délibéré : à la rentrée, sur une classe de trente, il y en a
   * toujours un ou deux qui ont déjà un dossier ouvert au guichet la veille.
   * Tout annuler pour ces deux-là obligerait le secrétariat à retrouver les
   * fautifs à la main avant de recommencer. Le lot passe donc pour tous les
   * autres, et le compte rendu dit précisément qui a été écarté et pourquoi.
   *
   * Les références restent uniques et consécutives : le compteur est atomique,
   * chaque création en consomme une.
   */
  async bulkEnroll(
    dto: BulkEnrollDto,
    schoolId: string,
    createdByUserId: string | null = null,
    actor?: AuthUser,
  ): Promise<{
    created: Array<{ studentId: string; reference: string; name: string }>;
    skipped: Array<{ studentId: string; name: string; reason: string }>;
  }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const classRoom = await this.classRoomRepository.findOne({
      where: { id: dto.classRoomId, schoolId },
    });
    if (!classRoom) {
      throw new NotFoundException(
        "La classe d'accueil n'existe pas dans cet établissement.",
      );
    }

    const academicYear = await this.academicYearRepository.findOne({
      where: { id: dto.academicYearId, schoolId },
    });
    if (!academicYear) {
      throw new NotFoundException(
        "L'année scolaire sélectionnée n'existe pas dans cet établissement.",
      );
    }

    // Même règle que pour une inscription unitaire : une réinscription en
    // masse dans une année close produirait des dizaines de dossiers morts.
    if (!academicYear.isActive) {
      throw new ConflictException(
        `L'année scolaire ${academicYear.label} est clôturée : la réinscription doit viser l'année en cours.`,
      );
    }

    const created: Array<{ studentId: string; reference: string; name: string }> = [];
    const skipped: Array<{ studentId: string; name: string; reason: string }> = [];

    // Les doublons de la liste sont écartés d'emblée : deux fois le même élève
    // dans la sélection ne doit pas produire deux dossiers.
    const uniqueIds = [...new Set(dto.studentIds)];

    /**
     * Le lot entier dans une seule transaction.
     *
     * Sans elle, une panne au trentième élève d'une liste de cinquante
     * laissait trente dossiers créés, vingt absents, et aucun moyen de savoir
     * où reprendre. Les refus métier — élève d'une autre école, dossier déjà
     * ouvert — sont détectés avant toute écriture et continuent d'alimenter
     * `skipped` : la transaction ne les annule pas, elle ne protège que des
     * défaillances techniques.
     */
    await this.dataSource.transaction(async (manager) => {
    for (const studentId of uniqueIds) {
      const student = await this.studentsService.findOneOfSchool(
        studentId,
        schoolId,
      );
      const name = student
        ? `${student.lastName} ${student.firstName}`
        : studentId;

      if (!student) {
        skipped.push({
          studentId,
          name,
          reason: "Cet élève n'appartient pas à l'établissement.",
        });
        continue;
      }

      try {
        const enrollment = await this.create(
          {
            schoolId,
            studentId,
            classRoomId: dto.classRoomId,
            academicYearId: dto.academicYearId,
          },
          createdByUserId,
          manager,
        );
        created.push({ studentId, reference: enrollment.reference, name });
      } catch (error) {
        skipped.push({
          studentId,
          name,
          reason:
            error instanceof ConflictException || error instanceof NotFoundException
              ? this.extractMessage(error)
              : 'Erreur inattendue lors de la création du dossier.',
        });
      }
    }
    });

    // Une seule ligne pour le lot, et non trente : le journal doit rester
    // lisible, et c'est bien une decision unique qui a ete prise.
    if (created.length > 0) {
      void this.auditService.record(
        {
          action: AuditAction.ENROLLMENT_BULK_CREATED,
          entityType: 'enrollments',
          entityId: null,
          schoolId,
          summary: `Reinscription en masse : ${created.length} dossier(s) ouverts en ${classRoom.name} pour ${academicYear.label}${skipped.length ? `, ${skipped.length} ecarte(s)` : ''}`,
          changes: {
            references: {
              before: null,
              after: created.map((c) => c.reference),
            },
          },
        },
        actor,
      );
    }

    return { created, skipped };
  }

  /**
   * Message lisible d'une exception HTTP, que la réponse soit une chaîne ou
   * l'objet enrichi renvoyé lors d'un doublon d'élève.
   */
  private extractMessage(error: ConflictException | NotFoundException): string {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return String(message[0]);
    return error.message;
  }

  /**
   * Correction d'un dossier : changement de classe.
   *
   * Deux usages, qui se traitent de la même façon : l'erreur de saisie du jour
   * de l'inscription (6ème A au lieu de 6ème B) et le changement de classe en
   * cours d'année.
   *
   * Le montant dû suit le tarif de la nouvelle classe. C'est nécessaire : le
   * tarif est recopié sur le dossier à la création, sans quoi un élève déplacé
   * d'une 6ème à 120 000 vers une 3ème à 165 000 resterait redevable de
   * l'ancien montant. Le statut est ensuite recalculé sur le nouveau total,
   * exactement comme le fait la caisse après un encaissement : un dossier
   * soldé peut ainsi redevenir partiellement payé, et inversement.
   *
   * Le déplacement est refusé si l'élève a déjà versé plus que le tarif de la
   * classe d'accueil : la correction créerait un trop-perçu que le système ne
   * sait pas représenter. Il faut alors annuler le versement en trop d'abord,
   * ce qui laisse une trace, plutôt que de faire disparaître la somme.
   */
  async update(
    id: string,
    dto: UpdateEnrollmentDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<EnrollmentWithBalance> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const enrollment = await this.enrollmentRepository.findOne({
      where: { id, schoolId },
    });
    if (!enrollment) {
      throw new NotFoundException(`Dossier introuvable (${id}).`);
    }

    if (!dto.classRoomId || dto.classRoomId === enrollment.classRoomId) {
      return await this.findByReference(schoolId, enrollment.reference);
    }

    const classRoom = await this.classRoomRepository.findOne({
      where: { id: dto.classRoomId, schoolId },
    });
    if (!classRoom) {
      throw new NotFoundException(
        "La classe demandée n'existe pas dans cet établissement.",
      );
    }

    const amountPaid = await this.balanceService.sumPayments(enrollment.id);
    const newTotalDue = Number(classRoom.tuitionFee) || 0;

    if (newTotalDue > 0 && amountPaid > newTotalDue) {
      throw new ConflictException(
        `Ce dossier a déjà reçu ${amountPaid.toLocaleString('fr-FR')} FCFA, soit plus que les frais de la classe ${classRoom.name} (${newTotalDue.toLocaleString('fr-FR')} FCFA). Annulez d'abord le versement excédentaire depuis le journal de caisse.`,
      );
    }

    const previousClassRoom = await this.classRoomRepository.findOne({
      where: { id: enrollment.classRoomId },
    });
    const before = {
      classRoom: previousClassRoom?.name ?? null,
      totalDue: Number(enrollment.totalDue),
      status: enrollment.status,
    };

    enrollment.classRoomId = classRoom.id;
    enrollment.totalDue = newTotalDue;

    if (newTotalDue > 0 && amountPaid >= newTotalDue) {
      enrollment.status = EnrollmentStatus.ENROLLED;
    } else if (amountPaid > 0) {
      enrollment.status = EnrollmentStatus.PARTIALLY_PAID;
    } else if (enrollment.status !== EnrollmentStatus.EXPIRED) {
      // Aucun versement : le dossier reste soumis à son jeton de 72h, dont
      // l'échéance n'est pas repoussée par une correction de classe.
      enrollment.status = EnrollmentStatus.PENDING_PAYMENT;
    }

    await this.enrollmentRepository.save(enrollment);

    void this.auditService.record(
      {
        action: AuditAction.ENROLLMENT_UPDATED,
        entityType: 'enrollments',
        entityId: enrollment.id,
        schoolId,
        summary: `Dossier ${enrollment.reference} deplace de ${before.classRoom ?? '?'} vers ${classRoom.name}`,
        changes: this.auditService.diff(before, {
          classRoom: classRoom.name,
          totalDue: newTotalDue,
          status: enrollment.status,
        }),
      },
      actor,
    );

    return await this.findByReference(schoolId, enrollment.reference);
  }

  /**
   * Suppression d'un dossier ouvert par erreur.
   *
   * Strictement réservée aux dossiers n'ayant jamais reçu le moindre
   * versement, y compris annulé : dès qu'un mouvement de caisse existe, le
   * dossier est une pièce comptable et ne s'efface pas — son numéro de reçu a
   * été délivré à une famille. Il faut alors annuler les versements, ce qui
   * conserve la trace de l'opération et du motif.
   *
   * La référence consommée n'est pas rendue : les compteurs ne reculent
   * jamais, un même numéro ne doit pas pouvoir désigner deux dossiers.
   *
   * Les notes et absences éventuellement saisies partent avec le dossier
   * (cascade en base) — c'est cohérent, elles n'ont de sens que rattachées à
   * une inscription.
   */
  async remove(
    id: string,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<{ message: string }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const enrollment = await this.enrollmentRepository.findOne({
      where: { id, schoolId },
      relations: { student: true },
    });
    if (!enrollment) {
      throw new NotFoundException(`Dossier introuvable (${id}).`);
    }

    const paymentCount = await this.paymentRepository.count({
      where: { enrollmentId: enrollment.id },
    });

    if (paymentCount > 0) {
      throw new ConflictException(
        `Le dossier ${enrollment.reference} porte ${paymentCount} versement(s) et ne peut pas être supprimé. Annulez-les depuis le journal de caisse : la trace de l'opération doit être conservée.`,
      );
    }

    const label = `${enrollment.student?.lastName ?? ''} ${enrollment.student?.firstName ?? ''}`.trim();
    const reference = enrollment.reference;
    await this.enrollmentRepository.remove(enrollment);

    void this.auditService.record(
      {
        action: AuditAction.ENROLLMENT_DELETED,
        entityType: 'enrollments',
        entityId: id,
        schoolId,
        summary: `Dossier ${reference} supprime${label ? ` (${label})` : ''} — aucun versement rattache`,
      },
      actor,
    );

    return {
      message: `Le dossier ${enrollment.reference}${label ? ` (${label})` : ''} a été supprimé. La fiche de l'élève est conservée.`,
    };
  }

  /**
   * Tous les dossiers correspondant aux filtres, sans pagination, pour export
   * tableur.
   *
   * S'appuie sur `findAll` plutôt que de reconstruire la requête : les filtres
   * et le calcul du solde restent définis à un seul endroit. La pagination est
   * simplement parcourue jusqu'à épuisement, par tranches larges — un
   * établissement compte quelques centaines de dossiers par année, deux ou
   * trois requêtes suffisent.
   */
  async findAllForExport(
    schoolId: string,
    query: QueryEnrollmentsDto,
  ): Promise<EnrollmentWithBalance[]> {
    const pageSize = 500;
    const all: EnrollmentWithBalance[] = [];

    for (let page = 1; ; page++) {
      const result = await this.findAll(schoolId, {
        ...query,
        page,
        limit: pageSize,
      });
      all.push(...result.items);

      if (result.items.length < pageSize || page >= result.totalPages) break;
    }

    return all;
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
  async findExpired(
    schoolId: string,
    academicYearId?: string,
  ): Promise<Enrollment[]> {
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

    /**
     * L'écran de rattrapage est borné à une année scolaire.
     *
     * Sans ce filtre il cumulait les dossiers expirés de toutes les années :
     * après deux ou trois rentrées, le secrétariat devait faire le tri entre
     * des dossiers rattrapables et des dossiers morts depuis longtemps, que
     * plus personne n'allait renouveler.
     *
     * À défaut de précision, l'année en cours. Si l'établissement n'en a
     * aucune d'active — clôture sans réactivation — on retombe sur la liste
     * complète plutôt que sur un écran vide inexplicable.
     */
    const scopedYearId =
      academicYearId ??
      (
        await this.academicYearRepository.findOne({
          where: { schoolId, isActive: true },
        })
      )?.id;

    const whereQuery: any = { status: EnrollmentStatus.EXPIRED, schoolId };
    if (scopedYearId) {
      whereQuery.academicYearId = scopedYearId;
    }

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
  async renew(
    id: string,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<Enrollment> {
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

    /**
     * Un dossier d'année clôturée ne se renouvelle pas.
     *
     * Renouveler remet 72 h au compteur et repasse le dossier en attente de
     * versement — dans son année d'origine. Sur une année close, cela rouvrait
     * par la bande ce que la création interdit : un dossier vivant dans une
     * année terminée, invisible du tableau de bord et absent des listes de
     * classe, mais bien facturé à la famille.
     *
     * Le renouvellement n'est volontairement pas rebasculé vers l'année en
     * cours : cela déplacerait un dossier d'une année à l'autre en conservant
     * ses versements et sa référence, ce qui fausserait deux exercices
     * comptables. La famille se réinscrit sur l'année en cours, ce qui produit
     * un dossier neuf et une référence neuve.
     */
    const year = await this.academicYearRepository.findOne({
      where: { id: enrollment.academicYearId, schoolId },
    });

    if (year && !year.isActive) {
      throw new ConflictException(
        `Le dossier ${enrollment.reference} appartient à l'année ${year.label}, qui est clôturée : ` +
          "il ne peut plus être renouvelé. Inscrivez l'élève sur l'année en cours.",
      );
    }

    // Clonage fantôme Multi-Tenant: Nouvelle référence personnalisée + Reset 72h
    const newReference = await this.generateReference(enrollment.schoolId);
    const newExpiresAt = this.calculate72HoursExpiration();

    const previousReference = enrollment.reference;

    enrollment.reference = newReference;
    enrollment.expiresAt = newExpiresAt;
    enrollment.status = EnrollmentStatus.PENDING_PAYMENT;

    const saved = await this.enrollmentRepository.save(enrollment);

    /**
     * Renouveler un dossier expiré remet 72 h au compteur et consomme une
     * nouvelle référence : c'est une décision de guichet, elle doit se voir.
     * L'ancienne référence est conservée dans le journal — c'est elle que la
     * famille détient sur son premier récépissé.
     */
    void this.auditService.record(
      {
        action: AuditAction.ENROLLMENT_RENEWED,
        entityType: 'enrollments',
        entityId: saved.id,
        schoolId,
        summary: `Dossier ${previousReference} renouvele sous la reference ${newReference}`,
        changes: {
          reference: { before: previousReference, after: newReference },
        },
      },
      actor,
    );

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
    result.previousDebts = await this.findPreviousDebts(
      enrollment.studentId,
      schoolId,
      enrollment.academicYearId,
    );
    return result;
  }

  /**
   * Dossiers d'années antérieures de l'élève encore partiellement réglés.
   *
   * Le cas se produit à chaque rentrée : une famille se réinscrit alors qu'il
   * reste un reliquat de l'année passée. Sans ce signal, la caisse encaissait
   * la nouvelle scolarité sans savoir qu'une ardoise courait, et l'impayé ne
   * refaisait surface qu'à l'édition des bulletins — ou jamais.
   *
   * Les dossiers expirés sont écartés : ce sont des inscriptions abandonnées,
   * pas des dettes.
   */
  private async findPreviousDebts(
    studentId: string,
    schoolId: string,
    currentAcademicYearId: string,
  ): Promise<EnrollmentWithBalance['previousDebts']> {
    const others = await this.enrollmentRepository.find({
      where: {
        studentId,
        schoolId,
        academicYearId: Not(currentAcademicYearId),
        status: EnrollmentStatus.PARTIALLY_PAID,
      },
      relations: { academicYear: true },
    });

    const debts = await Promise.all(
      others.map(async (other) => ({
        reference: other.reference,
        academicYearLabel: other.academicYear?.label ?? '',
        balance: (await this.balanceService.compute(other)).balance,
      })),
    );

    return debts.filter((d) => d.balance > 0);
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
