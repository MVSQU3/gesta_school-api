import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { BalanceService } from '../common/balance/balance.service';
import { Gender } from '../common/enums/gender.enum';
import { Role } from '../common/enums/role.enum';
import { generateTemporaryPassword } from '../common/utils/generate-password';
import { AbsencesService } from '../absences/absences.service';
import { BulletinsService } from '../bulletins/bulletins.service';
import { GradingPeriodsService } from '../grading-periods/grading-periods.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Grade } from '../evaluations/entities/grade.entity';
import { Payment } from '../payments/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { User } from '../users/entities/user.entity';
import { CreateParentDto } from './dto/create-parent.dto';
import { LinkChildDto } from './dto/link-child.dto';
import { ParentStudent } from './entities/parent-student.entity';
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/dto/pagination.dto';

/** Compte parent tel que le voit le secrétariat, enfants compris. */
export interface ParentSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  /** Male ou Female — remplace le lien de parenté saisi à la main. */
  gender: Gender | null;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  children: { studentId: string; fullName: string }[];
}

@Injectable()
export class ParentsService {
  constructor(
    @InjectRepository(ParentStudent)
    private readonly linkRepository: Repository<ParentStudent>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(Grade)
    private readonly gradeRepository: Repository<Grade>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(School)
    private readonly schoolRepository: Repository<School>,
    private readonly balanceService: BalanceService,
    private readonly absencesService: AbsencesService,
    private readonly bulletinsService: BulletinsService,
    private readonly gradingPeriodsService: GradingPeriodsService,
    private readonly auditService: AuditService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ------------------------------------------------------------------
  // Autorisation
  // ------------------------------------------------------------------

  /**
   * Vérifie qu'un parent a bien la tutelle d'un élève, et renvoie la fiche.
   *
   * **Tout** accès parent passe par ici. C'est volontairement le seul chemin :
   * le `schoolId` du jeton, qui suffit à autoriser un membre du personnel, ne
   * dit rien ici — deux parents de la même école ne doivent pas voir les
   * enfants l'un de l'autre. Une route parent qui oublierait cet appel
   * ouvrirait l'établissement entier.
   *
   * Le `schoolId` est malgré tout vérifié en plus du lien : une fiche élève
   * transférée à un autre établissement ne doit pas rester lisible par
   * l'ancien compte parent.
   */
  async assertGuardianOf(
    parentId: string,
    studentId: string,
    schoolId: string,
  ): Promise<Student> {
    const link = await this.linkRepository.findOne({
      where: { parentId, studentId, schoolId },
    });

    if (!link) {
      /**
       * Volontairement « introuvable » et non « accès refusé ».
       *
       * Distinguer les deux dirait au parent qu'un élève existe bien sous cet
       * identifiant, mais qu'il n'est pas le sien — une réponse différenciée
       * transforme la route en oracle permettant d'énumérer les élèves.
       */
      throw new NotFoundException("Cet élève n'est pas rattaché à votre compte.");
    }

    const student = await this.studentRepository.findOne({
      where: { id: studentId, schoolId },
    });
    if (!student) {
      throw new NotFoundException("Cet élève n'est pas rattaché à votre compte.");
    }
    return student;
  }

  /**
   * Résout l'inscription d'un enfant, après contrôle de tutelle.
   * Facteur commun à toutes les lectures : notes, absences et solde se
   * rattachent à l'inscription, pas à la fiche élève.
   */
  private async resolveChildEnrollment(
    parentId: string,
    enrollmentId: string,
    schoolId: string,
  ): Promise<Enrollment> {
    const enrollment = await this.enrollmentRepository.findOne({
      where: { id: enrollmentId, schoolId },
      relations: { student: true, classRoom: true, academicYear: true },
    });
    if (!enrollment) {
      throw new NotFoundException('Inscription introuvable.');
    }

    await this.assertGuardianOf(parentId, enrollment.studentId, schoolId);
    return enrollment;
  }

  // ------------------------------------------------------------------
  // Administration des comptes — côté secrétariat
  // ------------------------------------------------------------------

  /**
   * Crée un compte parent et rattache ses enfants.
   *
   * Le mot de passe provisoire est renvoyé en clair, une seule fois : il n'est
   * stocké nulle part, seul son hash l'est. Le secrétariat le remet à la
   * famille, et `mustChangePassword` force son remplacement à la première
   * connexion — un mot de passe transmis oralement ne doit pas rester valable.
   */
  async createParent(
    dto: CreateParentDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<{ parent: ParentSummary; temporaryPassword: string }> {
    const school = await this.schoolRepository.findOne({
      where: { id: schoolId },
    });
    if (!school) {
      throw new NotFoundException('Établissement introuvable.');
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException(
        'Un compte existe déjà avec cette adresse email.',
      );
    }

    // Les enfants sont validés avant la création du compte : mieux vaut
    // refuser que laisser derrière soi un compte parent sans aucun enfant,
    // que personne ne saura à quoi rattacher.
    const students = await this.loadStudentsOfSchool(
      dto.studentIds ?? [],
      schoolId,
    );

    const temporaryPassword = generateTemporaryPassword();

    /**
     * Compte et rattachements dans une seule transaction.
     *
     * Séparément, un échec sur les liens laissait un compte parent sans aucun
     * enfant : il ne verrait rien, et personne au secrétariat ne saurait à quoi
     * le rattacher. Le compte n'existe que s'il est utilisable.
     */
    const saved = await this.dataSource.transaction(async (manager) => {
      const parent = manager.create(User, {
        email,
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        roles: [Role.PARENT],
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        gender: dto.gender,
        phone: dto.phone?.trim() || null,
        slug: school.slug,
        schoolId: school.id,
        mustChangePassword: true,
      });
      const created = await manager.save(parent);

      if (students.length > 0) {
        await manager.save(
          students.map((student) =>
            manager.create(ParentStudent, {
              parentId: created.id,
              studentId: student.id,
              schoolId,
            }),
          ),
        );
      }

      return created;
    });

    void this.auditService.record(
      {
        action: AuditAction.PARENT_CREATED,
        entityType: 'users',
        entityId: saved.id,
        schoolId,
        summary: `Compte parent ${saved.email} cree, ${students.length} enfant(s) rattache(s)`,
      },
      actor,
    );

    return {
      parent: await this.findOneSummary(saved.id, schoolId),
      temporaryPassword,
    };
  }

  /** Charge des fiches élèves en vérifiant qu'elles sont toutes de l'école. */
  private async loadStudentsOfSchool(
    studentIds: string[],
    schoolId: string,
  ): Promise<Student[]> {
    const unique = [...new Set(studentIds)];
    if (unique.length === 0) return [];

    const students = await this.studentRepository.find({
      where: { id: In(unique), schoolId },
    });

    if (students.length !== unique.length) {
      /**
       * Message identique que la fiche soit inexistante ou qu'elle appartienne
       * à une autre école : le secrétariat n'a pas à apprendre par ce biais
       * qu'un identifiant est valide ailleurs dans le réseau.
       */
      throw new NotFoundException(
        "Au moins un des élèves indiqués est introuvable dans cet établissement.",
      );
    }
    return students;
  }

  /** Liste les comptes parents de l'établissement, avec leurs enfants. */
  /**
   * Comptes parents de l'établissement, paginés.
   *
   * Une école compte autant de comptes parents que de familles : quelques
   * centaines à quelques milliers. Les rendre tous chargeait la liste entière
   * à chaque frappe dans la recherche.
   */
  async findAllOfSchool(
    schoolId: string,
    search?: string,
    pagination?: PaginationQueryDto,
  ): Promise<PaginatedResult<ParentSummary>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 25;
    const query = this.usersRepository
      .createQueryBuilder('user')
      .where('user.schoolId = :schoolId', { schoolId })
      .andWhere(':role = ANY(user.roles)', { role: Role.PARENT })
      .orderBy('user.lastName', 'ASC')
      .addOrderBy('user.firstName', 'ASC');

    const term = search?.trim();
    if (term) {
      query.andWhere(
        '(user.lastName ILIKE :term OR user.firstName ILIKE :term OR user.email ILIKE :term OR user.phone ILIKE :term)',
        { term: `%${term}%` },
      );
    }

    const [parents, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    if (parents.length === 0) {
      return buildPaginatedResult<ParentSummary>([], total, page, limit);
    }

    // Une seule requête pour tous les liens, plutôt qu'une par parent : la
    // liste du secrétariat en compte facilement plusieurs centaines.
    const links = await this.linkRepository.find({
      where: { parentId: In(parents.map((p) => p.id)), schoolId },
      relations: { student: true },
    });

    return buildPaginatedResult(
      parents.map((parent) => this.toSummary(parent, links)),
      total,
      page,
      limit,
    );
  }

  /** Détail d'un compte parent. */
  async findOneSummary(
    parentId: string,
    schoolId: string,
  ): Promise<ParentSummary> {
    const parent = await this.usersRepository.findOne({
      where: { id: parentId, schoolId },
    });
    if (!parent || !parent.roles.includes(Role.PARENT)) {
      throw new NotFoundException('Compte parent introuvable.');
    }

    const links = await this.linkRepository.find({
      where: { parentId, schoolId },
      relations: { student: true },
    });

    return this.toSummary(parent, links);
  }

  private toSummary(parent: User, links: ParentStudent[]): ParentSummary {
    return {
      id: parent.id,
      email: parent.email,
      firstName: parent.firstName,
      lastName: parent.lastName,
      phone: parent.phone,
      gender: parent.gender,
      isActive: parent.isActive,
      mustChangePassword: parent.mustChangePassword,
      createdAt: parent.createdAt,
      children: links
        .filter((l) => l.parentId === parent.id)
        .map((l) => ({
          studentId: l.studentId,
          fullName: l.student
            ? `${l.student.firstName} ${l.student.lastName}`
            : '',
        })),
    };
  }

  /** Rattache un enfant supplémentaire à un compte parent. */
  async linkChild(
    parentId: string,
    dto: LinkChildDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<ParentSummary> {
    // Valide en un seul appel que le compte existe, est bien un parent, et
    // appartient à l'école résolue.
    await this.findOneSummary(parentId, schoolId);
    const [student] = await this.loadStudentsOfSchool([dto.studentId], schoolId);

    const existing = await this.linkRepository.findOne({
      where: { parentId, studentId: dto.studentId },
    });
    if (existing) {
      throw new ConflictException(
        'Cet enfant est déjà rattaché à ce compte parent.',
      );
    }

    await this.linkRepository.save(
      this.linkRepository.create({
        parentId,
        studentId: student.id,
        schoolId,
      }),
    );

    void this.auditService.record(
      {
        action: AuditAction.PARENT_CHILD_LINKED,
        entityType: 'parent_students',
        entityId: parentId,
        schoolId,
        summary: `Eleve ${student.firstName} ${student.lastName} rattache au compte parent`,
      },
      actor,
    );

    return this.findOneSummary(parentId, schoolId);
  }

  /** Retire un enfant d'un compte parent. */
  async unlinkChild(
    parentId: string,
    studentId: string,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<ParentSummary> {
    const link = await this.linkRepository.findOne({
      where: { parentId, studentId, schoolId },
      relations: { student: true },
    });
    if (!link) {
      throw new NotFoundException('Ce rattachement n’existe pas.');
    }

    await this.linkRepository.remove(link);

    void this.auditService.record(
      {
        action: AuditAction.PARENT_CHILD_UNLINKED,
        entityType: 'parent_students',
        entityId: parentId,
        schoolId,
        summary: `Eleve ${link.student?.firstName ?? ''} ${link.student?.lastName ?? ''} detache du compte parent`.trim(),
      },
      actor,
    );

    return this.findOneSummary(parentId, schoolId);
  }

  // ------------------------------------------------------------------
  // Espace parent — lectures
  // ------------------------------------------------------------------

  /**
   * Les enfants du parent connecté, avec pour chacun l'inscription de l'année
   * en cours et sa situation financière.
   *
   * C'est l'écran d'accueil de l'espace parent : il doit répondre à « où en
   * est mon dossier » sans navigation supplémentaire.
   */
  async getMyChildren(
    parentId: string,
    schoolId: string,
    academicYearId?: string,
  ) {
    const links = await this.linkRepository.find({
      where: { parentId, schoolId },
      relations: { student: true },
      order: { createdAt: 'ASC' },
    });
    if (links.length === 0) return [];

    const enrollments = await this.enrollmentRepository.find({
      where: { studentId: In(links.map((l) => l.studentId)), schoolId },
      relations: { classRoom: true, academicYear: true },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      links.map(async (link) => {
        /**
         * Inscription retenue pour cet enfant.
         *
         * Avec une année demandée, celle de cette année — quitte à n'en avoir
         * aucune, l'enfant n'ayant pas été inscrit cette année-là. Sans
         * précision, la plus récente : `enrollments` est trié par date
         * décroissante.
         *
         * Auparavant seule la plus récente était rendue, sans dire de quelle
         * année elle relevait : un parent dont l'enfant n'était pas encore
         * réinscrit consultait le dossier de l'an passé en le croyant à jour.
         */
        const ofStudent = enrollments.filter(
          (e) => e.studentId === link.studentId,
        );
        const enrollment = academicYearId
          ? ofStudent.find((e) => e.academicYearId === academicYearId)
          : ofStudent[0];

        return {
          studentId: link.studentId,
          firstName: link.student?.firstName ?? '',
          lastName: link.student?.lastName ?? '',
          enrollment: enrollment
            ? {
                id: enrollment.id,
                reference: enrollment.reference,
                status: enrollment.status,
                expiresAt: enrollment.expiresAt,
                classRoom: enrollment.classRoom,
                /**
                 * `isActive` voyage avec l'année : c'est lui qui permet à
                 * l'écran d'annoncer « année clôturée » au lieu de laisser
                 * croire que la situation affichée est celle du jour.
                 */
                academicYear: enrollment.academicYear,
                balance: await this.balanceService.compute(enrollment),
              }
            : null,
        };
      }),
    );
  }

  /**
   * Années scolaires que le parent peut consulter.
   *
   * Uniquement celles où au moins un de ses enfants a été inscrit : proposer
   * l'ensemble des années de l'établissement afficherait des périodes vides,
   * et renseignerait au passage sur l'ancienneté de l'école.
   */
  async getMyYears(parentId: string, schoolId: string) {
    const links = await this.linkRepository.find({
      where: { parentId, schoolId },
    });
    if (links.length === 0) return [];

    const enrollments = await this.enrollmentRepository.find({
      where: { studentId: In(links.map((l) => l.studentId)), schoolId },
      relations: { academicYear: true },
    });

    const byId = new Map<
      string,
      { id: string; label: string; isActive: boolean }
    >();
    for (const enrollment of enrollments) {
      const year = enrollment.academicYear;
      if (year && !byId.has(year.id)) {
        byId.set(year.id, {
          id: year.id,
          label: year.label,
          isActive: year.isActive,
        });
      }
    }

    // Décroissant : l'année la plus récente en tête, c'est celle qu'on ouvre.
    return [...byId.values()].sort((a, b) => b.label.localeCompare(a.label));
  }

  /**
   * Détail financier d'un dossier : solde et versements encaissés.
   *
   * Les versements annulés sont conservés dans la réponse, avec leur motif :
   * une famille qui a reçu un reçu papier doit pouvoir constater son
   * annulation, et non voir la ligne disparaître sans explication.
   */
  async getChildFinance(
    parentId: string,
    enrollmentId: string,
    schoolId: string,
  ) {
    const enrollment = await this.resolveChildEnrollment(
      parentId,
      enrollmentId,
      schoolId,
    );

    const payments = await this.paymentRepository.find({
      where: { enrollmentId: enrollment.id },
      order: { paidAt: 'DESC' },
    });

    return {
      enrollment: {
        id: enrollment.id,
        reference: enrollment.reference,
        status: enrollment.status,
        classRoom: enrollment.classRoom,
        academicYear: enrollment.academicYear,
      },
      balance: await this.balanceService.compute(enrollment),
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        receiptNumber: p.receiptNumber,
        paidAt: p.paidAt,
        cancelledAt: p.cancelledAt,
        cancellationReason: p.cancellationReason,
      })),
    };
  }

  /**
   * Périodes de notation de l'année de l'enfant.
   *
   * Route propre à l'espace parent plutôt qu'un élargissement de
   * `GET /grading-periods` : cette dernière est une route d'établissement, et
   * y ajouter le rôle PARENT reviendrait à percer l'invariant du module — un
   * parent ne voit que ce qui passe par `assertGuardianOf()`. Ici la tutelle
   * est vérifiée d'abord, et seule l'année de l'enfant est consultée.
   *
   * Sans cet appel, l'onglet « Notes » restait vide : la requête vers la route
   * d'établissement était refusée, et l'écran l'interprétait comme une absence
   * de période.
   */
  async getChildPeriods(
    parentId: string,
    enrollmentId: string,
    schoolId: string,
  ) {
    const enrollment = await this.resolveChildEnrollment(
      parentId,
      enrollmentId,
      schoolId,
    );

    return this.gradingPeriodsService.findAllByYear(
      schoolId,
      enrollment.academicYearId,
    );
  }

  /** Bulletin d'un enfant sur une période — mêmes calculs que côté école. */
  async getChildBulletin(
    parentId: string,
    enrollmentId: string,
    gradingPeriodId: string,
    schoolId: string,
  ) {
    await this.resolveChildEnrollment(parentId, enrollmentId, schoolId);
    return this.bulletinsService.getStudentBulletin(
      schoolId,
      enrollmentId,
      gradingPeriodId,
    );
  }

  /**
   * Notes individuelles d'un enfant sur une période, groupées par matière.
   *
   * Le bulletin ne donne que des moyennes par matière : une famille qui
   * constate un 9,29 de moyenne veut voir les devoirs qui l'ont produite,
   * et savoir lequel a fait chuter le résultat. C'est le détail que le
   * bulletin résume, pas un calcul différent.
   *
   * La note est rendue telle qu'elle a été saisie — `score` sur `maxScore` —
   * et non ramenée sur 20 : un 7/10 affiché « 14/20 » ne correspondrait plus
   * à la copie que l'élève rapporte à la maison. La conversion reste interne
   * au calcul de moyenne.
   */
  async getChildGrades(
    parentId: string,
    enrollmentId: string,
    gradingPeriodId: string,
    schoolId: string,
  ) {
    await this.resolveChildEnrollment(parentId, enrollmentId, schoolId);

    const grades = await this.gradeRepository.find({
      where: { enrollmentId, schoolId },
      relations: { evaluation: { subject: true } },
    });

    // Seules les notes de la période demandée : le filtre porte sur
    // l'évaluation, la note elle-même n'ayant pas de période propre.
    const ofPeriod = grades.filter(
      (g) => g.evaluation?.gradingPeriodId === gradingPeriodId,
    );

    const bySubject = new Map<
      string,
      {
        subjectId: string;
        name: string;
        grades: Array<{
          id: string;
          title: string;
          type: string;
          date: Date;
          score: number | null;
          maxScore: number;
          isAbsent: boolean;
          comment: string | null;
        }>;
      }
    >();

    for (const grade of ofPeriod) {
      const evaluation = grade.evaluation;
      if (!evaluation) continue;

      const entry = bySubject.get(evaluation.subjectId) ?? {
        subjectId: evaluation.subjectId,
        name: evaluation.subject?.name ?? 'Matière',
        grades: [],
      };

      entry.grades.push({
        id: grade.id,
        title: evaluation.title,
        type: evaluation.type,
        date: evaluation.date,
        score: grade.score === null ? null : Number(grade.score),
        maxScore: evaluation.maxScore,
        isAbsent: grade.isAbsent,
        /**
         * L'appréciation du professeur est transmise telle quelle : elle est
         * écrite à destination de la famille, la lui masquer n'aurait pas de
         * sens.
         */
        comment: grade.comment,
      });
      bySubject.set(evaluation.subjectId, entry);
    }

    // Les plus récentes en tête dans chaque matière, matières par ordre
    // alphabétique — l'ordre dans lequel elles figurent au bulletin.
    return [...bySubject.values()]
      .map((subject) => ({
        ...subject,
        grades: subject.grades.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Absences et retards d'un enfant. */
  async getChildAbsences(
    parentId: string,
    enrollmentId: string,
    schoolId: string,
  ) {
    await this.resolveChildEnrollment(parentId, enrollmentId, schoolId);
    return this.absencesService.findByEnrollment(enrollmentId, schoolId);
  }

  /**
   * Garde-fou appelé par le contrôleur avant toute route de l'espace parent.
   *
   * Un compte parent est nécessairement rattaché à une école ; l'absence de
   * `schoolId` signalerait un jeton forgé ou un compte mal créé, et la suite
   * du traitement filtrerait alors sur `undefined`.
   */
  requireParentSchool(user: AuthUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException(
        "Ce compte n'est rattaché à aucun établissement.",
      );
    }
    return user.schoolId;
  }

  /** Réinitialise le mot de passe d'un parent, à la demande du secrétariat. */
  async resetPassword(
    parentId: string,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<{ temporaryPassword: string }> {
    const parent = await this.usersRepository.findOne({
      where: { id: parentId, schoolId },
    });
    if (!parent || !parent.roles.includes(Role.PARENT)) {
      throw new NotFoundException('Compte parent introuvable.');
    }

    const temporaryPassword = generateTemporaryPassword();
    parent.passwordHash = await bcrypt.hash(temporaryPassword, 12);
    // Tronqué à la seconde, comme pour le personnel : le champ `iat` d'un JWT
    // est en secondes, et des millisecondes feraient rejeter un jeton émis
    // dans la même seconde.
    parent.passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    parent.mustChangePassword = true;
    await this.usersRepository.save(parent);

    void this.auditService.record(
      {
        action: AuditAction.USER_PASSWORD_RESET,
        entityType: 'users',
        entityId: parent.id,
        schoolId,
        summary: `Mot de passe du compte parent ${parent.email} reinitialise`,
      },
      actor,
    );

    return { temporaryPassword };
  }

  /** Active ou désactive un compte parent sans le supprimer. */
  async setActive(
    parentId: string,
    isActive: boolean,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<ParentSummary> {
    const parent = await this.usersRepository.findOne({
      where: { id: parentId, schoolId },
    });
    if (!parent || !parent.roles.includes(Role.PARENT)) {
      throw new NotFoundException('Compte parent introuvable.');
    }
    if (typeof isActive !== 'boolean') {
      throw new BadRequestException('Le statut attendu est un booléen.');
    }

    parent.isActive = isActive;
    // Désactiver doit fermer les sessions en cours, sans quoi le compte reste
    // utilisable jusqu'à l'expiration naturelle du jeton.
    if (!isActive) {
      parent.passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    }
    await this.usersRepository.save(parent);

    void this.auditService.record(
      {
        action: AuditAction.USER_STATUS_CHANGED,
        entityType: 'users',
        entityId: parent.id,
        schoolId,
        summary: `Compte parent ${parent.email} ${isActive ? 'active' : 'desactive'}`,
      },
      actor,
    );

    return this.findOneSummary(parentId, schoolId);
  }
}
