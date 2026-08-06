import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import { BalanceService } from '../common/balance/balance.service';
import { ReferencesService } from '../common/counters/references.service';
import { School } from '../schools/entities/school.entity';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/dto/pagination.dto';
import { CancelPaymentDto } from './dto/cancel-payment.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentResult } from './dto/payment-summary.dto';
import { CashJournalSummary, QueryPaymentsDto } from './dto/query-payments.dto';
import { Payment, PaymentMethod } from './entities/payment.entity';

/**
 * Signal interne : le jeton est expiré. Sert à sortir de la transaction par un
 * rollback, tout en gardant la trace de l'inscription à basculer en EXPIRED
 * une fois la transaction annulée (voir processPayment).
 */
class TokenExpiredSignal extends Error {
  constructor(
    readonly enrollmentId: string,
    readonly alreadyMarked: boolean,
  ) {
    super('TOKEN_EXPIRED');
  }
}

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    private readonly referencesService: ReferencesService,
    private readonly balanceService: BalanceService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Génère un numéro de reçu de caisse unique au format REC-CODE-YY-XXXX (ex: REC-CMB-26-0001).
   * La séquence est réservée en base de façon atomique et repart à 0001 à chaque
   * nouvelle année civile.
   */
  private async generateReceiptNumber(
    schoolId: string,
    schoolSlug: string,
    manager?: EntityManager,
  ): Promise<string> {
    return await this.referencesService.nextReceiptNumber(
      schoolId,
      schoolSlug,
      manager,
    );
  }

  /**
   * Valide l'encaissement à la caisse pour un ticket d'inscription Multi-Tenant.
   *
   * L'ensemble — réservation du numéro de reçu, écriture du paiement et passage
   * de l'inscription à ENROLLED — s'exécute dans une transaction unique : une
   * coupure en cours de route ne peut plus laisser un paiement encaissé sur une
   * inscription restée en PENDING_PAYMENT.
   *
   * L'inscription est par ailleurs verrouillée (SELECT ... FOR UPDATE) pendant
   * toute la transaction : deux caisses qui encaissent la même référence en même
   * temps sont sérialisées, et la seconde voit le statut ENROLLED déjà commité.
   */
  async processPayment(
    createPaymentDto: CreatePaymentDto,
    schoolId: string,
    slug: string,
    receivedByUserId: string | null = null,
  ): Promise<PaymentResult> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    try {
      return await this.dataSource.transaction(async (manager) => {
        // 1. Chargement + verrouillage de la ligne d'inscription.
        //    Pas de relations ici : PostgreSQL refuse FOR UPDATE sur un LEFT JOIN.
        const enrollment = await manager.findOne(Enrollment, {
          where: { reference: createPaymentDto.reference, schoolId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!enrollment) {
          throw new NotFoundException(
            `Aucune inscription trouvée pour la référence ${createPaymentDto.reference}`,
          );
        }

        // 2. Dossier déjà soldé
        if (enrollment.status === EnrollmentStatus.ENROLLED) {
          throw new BadRequestException(
            `L’inscription avec la référence ${createPaymentDto.reference} a déjà été intégralement réglée.`,
          );
        }

        // 3. Vérification de l'expiration (72h).
        //    Un dossier ayant déjà reçu un versement ne peut plus expirer :
        //    la place est acquise, seul le solde reste à recouvrer.
        const now = new Date();
        const isAwaitingFirstPayment =
          enrollment.status === EnrollmentStatus.PENDING_PAYMENT;
        if (
          enrollment.status === EnrollmentStatus.EXPIRED ||
          (isAwaitingFirstPayment && enrollment.expiresAt < now)
        ) {
          // On ne peut pas marquer EXPIRED ici : le rollback l'annulerait.
          // Le basculement est fait après l'annulation de la transaction.
          throw new TokenExpiredSignal(
            enrollment.id,
            enrollment.status === EnrollmentStatus.EXPIRED,
          );
        }

        // 4. Calcul du solde à partir des versements déjà encaissés.
        //    La lecture est protégée par le verrou posé à l'étape 1 : aucun
        //    autre versement ne peut s'intercaler entre ce calcul et l'écriture.
        const amountPaid = await this.balanceService.sumPayments(
          enrollment.id,
          manager,
        );
        const totalDue = Number(enrollment.totalDue) || 0;
        const balance = Math.max(totalDue - amountPaid, 0);

        // Un total dû à 0 signifie qu'aucun tarif n'est configuré pour la
        // classe : on accepte le versement sans contrôle de dépassement.
        if (totalDue > 0 && createPaymentDto.amount > balance) {
          throw new BadRequestException(
            `Le montant saisi (${createPaymentDto.amount} FCFA) dépasse le solde restant dû (${balance} FCFA).`,
          );
        }

        // 5. Réservation du numéro de reçu dans la même transaction :
        //    si la suite échoue, la séquence est rendue plutôt que consommée.
        const school = await manager.findOne(School, {
          where: { id: schoolId },
        });
        const schoolSlug = school ? school.slug : slug || 'SCH';
        const receiptNumber = await this.generateReceiptNumber(
          schoolId,
          schoolSlug,
          manager,
        );

        // 6. Écriture du versement
        const payment = manager.create(Payment, {
          enrollmentId: enrollment.id,
          amount: createPaymentDto.amount,
          method: createPaymentDto.method ?? PaymentMethod.CASH,
          receiptNumber,
          schoolId,
          receivedByUserId,
        });
        const savedPayment = await manager.save(payment);

        // 7. Mise à jour du statut selon le solde restant
        const newAmountPaid = amountPaid + createPaymentDto.amount;
        const newBalance = Math.max(totalDue - newAmountPaid, 0);
        const isFullyPaid = totalDue <= 0 || newAmountPaid >= totalDue;

        enrollment.status = isFullyPaid
          ? EnrollmentStatus.ENROLLED
          : EnrollmentStatus.PARTIALLY_PAID;
        await manager.save(enrollment);

        // Recharger l'inscription complète pour le reçu imprimable
        const result = savedPayment as PaymentResult;
        result.enrollment = (await manager.findOne(Enrollment, {
          where: { id: enrollment.id },
          relations: {
            school: true,
            student: true,
            classRoom: true,
            academicYear: true,
          },
        })) as Enrollment;

        result.balanceAfter = {
          totalDue,
          amountPaid: newAmountPaid,
          balance: newBalance,
          isFullyPaid,
          status: enrollment.status,
        };

        return result;
      });
    } catch (error) {
      if (error instanceof TokenExpiredSignal) {
        // La transaction est annulée : on bascule le dossier en EXPIRED
        // dans une écriture indépendante, comme avant.
        if (!error.alreadyMarked) {
          await this.enrollmentRepository.update(
            { id: error.enrollmentId },
            { status: EnrollmentStatus.EXPIRED },
          );
        }

        throw new BadRequestException(
          `Le jeton ${createPaymentDto.reference} a expiré (délai de 72h dépassé). Veuillez renouveler l'inscription auprès du secrétariat via l'onglet 'Les Oubliés'.`,
        );
      }
      throw error;
    }
  }

  /**
   * Annule un versement.
   *
   * Le versement n'est jamais supprimé : la ligne reste en base avec son numéro
   * de reçu, sa date, son caissier, plus le motif et l'auteur de l'annulation.
   * Elle continue d'apparaître dans le journal de caisse, barrée, mais sort de
   * tous les totaux et du calcul du solde.
   *
   * Le statut du dossier est recalculé dans la même transaction :
   *  - plus aucun versement valide  → PENDING_PAYMENT
   *  - solde partiellement couvert  → PARTIALLY_PAID
   *  - toujours intégralement payé  → ENROLLED
   *
   * Un dossier qui retombe à zéro et dont l'échéance de 72h est dépassée sera
   * basculé en EXPIRED par la ronde automatique, et réapparaîtra dans
   * « Les Oubliés » où le secrétariat pourra le renouveler.
   */
  async cancel(
    paymentId: string,
    dto: CancelPaymentDto,
    schoolId: string,
    cancelledByUserId: string | null = null,
  ): Promise<Payment> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    return await this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, {
        where: { id: paymentId, schoolId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!payment) {
        throw new NotFoundException(
          `Reçu introuvable avec l'identifiant ${paymentId}`,
        );
      }

      if (payment.cancelledAt) {
        throw new BadRequestException(
          `Le reçu ${payment.receiptNumber} a déjà été annulé.`,
        );
      }

      // Verrouiller aussi le dossier : son statut va être recalculé, et un
      // encaissement concurrent ne doit pas s'intercaler.
      const enrollment = await manager.findOne(Enrollment, {
        where: { id: payment.enrollmentId },
        lock: { mode: 'pessimistic_write' },
      });

      payment.cancelledAt = new Date();
      payment.cancellationType = dto.type;
      payment.cancellationReason = dto.reason.trim();
      payment.cancelledByUserId = cancelledByUserId;
      await manager.save(payment);

      if (enrollment) {
        const remaining = await this.balanceService.sumPayments(
          enrollment.id,
          manager,
        );
        const totalDue = Number(enrollment.totalDue) || 0;

        if (remaining <= 0) {
          enrollment.status = EnrollmentStatus.PENDING_PAYMENT;
        } else if (totalDue > 0 && remaining < totalDue) {
          enrollment.status = EnrollmentStatus.PARTIALLY_PAID;
        } else {
          enrollment.status = EnrollmentStatus.ENROLLED;
        }
        await manager.save(enrollment);
      }

      return (await manager.findOne(Payment, {
        where: { id: paymentId },
        relations: {
          receivedByUser: true,
          cancelledByUser: true,
          enrollment: { student: true, classRoom: true, school: true },
        },
      })) as Payment;
    });
  }

  /**
   * Borne une journée complète : du premier au dernier instant.
   * `to` est inclusif, pour que « du 1er au 1er » couvre bien toute la journée.
   */
  private resolvePeriod(from?: string, to?: string): { start: Date; end: Date } {
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const [fy, fm, fd] = (from ?? isoToday).split('-').map(Number);
    const [ty, tm, td] = (to ?? from ?? isoToday).split('-').map(Number);

    return {
      start: new Date(fy, fm - 1, fd, 0, 0, 0, 0),
      end: new Date(ty, tm - 1, td, 23, 59, 59, 999),
    };
  }

  /**
   * Journal de caisse : versements d'une période, avec les totaux consolidés.
   *
   * Les totaux portent sur l'ensemble de la période, pas seulement sur la page
   * affichée — c'est ce qui permet la clôture de caisse.
   */
  async findJournal(
    schoolId: string,
    query: QueryPaymentsDto,
  ): Promise<PaginatedResult<Payment> & { summary: CashJournalSummary }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const { start, end } = this.resolvePeriod(query.from, query.to);

    const applyFilters = (qb: SelectQueryBuilder<Payment>) => {
      qb.where('payment.schoolId = :schoolId', { schoolId }).andWhere(
        'payment.paidAt BETWEEN :start AND :end',
        { start, end },
      );
      if (query.method) {
        qb.andWhere('payment.method = :method', { method: query.method });
      }
      if (query.receivedByUserId) {
        qb.andWhere('payment."receivedByUserId" = :receivedByUserId', {
          receivedByUserId: query.receivedByUserId,
        });
      }
      return qb;
    };

    // Page de résultats
    const listQb = applyFilters(
      this.paymentRepository
        .createQueryBuilder('payment')
        .leftJoinAndSelect('payment.receivedByUser', 'cashier')
        .leftJoinAndSelect('payment.enrollment', 'enrollment')
        .leftJoinAndSelect('enrollment.student', 'student')
        .leftJoinAndSelect('enrollment.classRoom', 'classRoom'),
    )
      .orderBy('payment.paidAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    // Totaux par mode de règlement, sur toute la période.
    // Les versements annulés restent visibles dans la liste mais sont exclus
    // des totaux : la caisse ne doit pas être créditée d'un montant annulé.
    const totalsQb = applyFilters(
      this.paymentRepository
        .createQueryBuilder('payment')
        .select('payment.method', 'method')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'amount'),
    )
      .andWhere('payment.cancelledAt IS NULL')
      .groupBy('payment.method');

    // Total annulé sur la période, affiché à part pour la justification
    const cancelledQb = applyFilters(
      this.paymentRepository
        .createQueryBuilder('payment')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'amount'),
    ).andWhere('payment.cancelledAt IS NOT NULL');

    const [items, total, rows, cancelledRow] = await Promise.all([
      listQb.getMany(),
      listQb.getCount(),
      totalsQb.getRawMany<{ method: PaymentMethod; count: string; amount: string }>(),
      cancelledQb.getRawOne<{ count: string; amount: string }>(),
    ]);

    const byMethod = Object.values(PaymentMethod).reduce(
      (acc, method) => ({ ...acc, [method]: { count: 0, amount: 0 } }),
      {} as CashJournalSummary['byMethod'],
    );
    let count = 0;
    let totalAmount = 0;
    for (const row of rows) {
      const entry = { count: Number(row.count), amount: Number(row.amount) };
      byMethod[row.method] = entry;
      count += entry.count;
      totalAmount += entry.amount;
    }

    const toIso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return {
      ...buildPaginatedResult(items, total, page, limit),
      summary: {
        from: toIso(start),
        to: toIso(end),
        count,
        totalAmount,
        byMethod,
        cancelledCount: Number(cancelledRow?.count ?? 0),
        cancelledAmount: Number(cancelledRow?.amount ?? 0),
      },
    };
  }

  /**
   * Journal de caisse complet d'une période, pour export tableur.
   *
   * Sans pagination, contrairement à l'affichage : un journal exporté sur une
   * page de vingt-cinq lignes ne servirait à rien à la comptabilité. Les
   * versements annulés sont inclus — c'est précisément ce qu'un contrôle vient
   * vérifier — avec leur motif et leur auteur.
   */
  async findJournalForExport(
    schoolId: string,
    query: QueryPaymentsDto,
  ): Promise<Payment[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const { start, end } = this.resolvePeriod(query.from, query.to);

    const qb = this.paymentRepository
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.receivedByUser', 'cashier')
      .leftJoinAndSelect('payment.cancelledByUser', 'canceller')
      .leftJoinAndSelect('payment.enrollment', 'enrollment')
      .leftJoinAndSelect('enrollment.student', 'student')
      .leftJoinAndSelect('enrollment.classRoom', 'classRoom')
      .leftJoinAndSelect('enrollment.academicYear', 'academicYear')
      .where('payment.schoolId = :schoolId', { schoolId })
      .andWhere('payment.paidAt BETWEEN :start AND :end', { start, end });

    if (query.method) {
      qb.andWhere('payment.method = :method', { method: query.method });
    }
    if (query.receivedByUserId) {
      qb.andWhere('payment."receivedByUserId" = :receivedByUserId', {
        receivedByUserId: query.receivedByUserId,
      });
    }

    return await qb.orderBy('payment.paidAt', 'ASC').getMany();
  }

  /**
   * Historique des versements d'une inscription (l'échéancier), du plus ancien
   * au plus récent, avec le caissier ayant encaissé chacun d'eux.
   */
  async findByEnrollment(
    enrollmentId: string,
    schoolId: string,
  ): Promise<Payment[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    return await this.paymentRepository.find({
      where: { enrollmentId, schoolId },
      relations: { receivedByUser: true },
      order: { paidAt: 'ASC' },
    });
  }

  /**
   * Retrouve un reçu par son numéro, pour réimpression au guichet.
   *
   * Le reçu est reconstitué tel qu'il était : `balanceAfter` reprend le cumul
   * des versements valides jusqu'à celui-ci inclus, et non la situation
   * actuelle du dossier. Réimprimer un reçu de septembre ne doit pas afficher
   * le solde de décembre.
   */
  async findByReceiptNumber(
    receiptNumber: string,
    schoolId: string,
  ): Promise<PaymentResult> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const payment = await this.paymentRepository.findOne({
      where: { receiptNumber: receiptNumber.trim().toUpperCase(), schoolId },
      relations: {
        receivedByUser: true,
        cancelledByUser: true,
        enrollment: {
          school: true,
          student: true,
          classRoom: true,
          academicYear: true,
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Aucun reçu trouvé avec le numéro ${receiptNumber}`,
      );
    }

    // Cumul des versements valides jusqu'à ce reçu inclus.
    //
    // La comparaison se fait entièrement en SQL, sur le couple (paidAt, id) :
    // le timestamp PostgreSQL est stocké à la microseconde, alors qu'un Date
    // JavaScript est tronqué à la milliseconde. Repasser par JS ferait sortir
    // le reçu de sa propre somme. L'id sert de départage en cas d'égalité
    // stricte de l'horodatage.
    const rows: Array<{ total: string }> = await this.paymentRepository.query(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
         FROM payments p
        WHERE p."enrollmentId" = $1
          AND p."cancelledAt" IS NULL
          AND (p."paidAt", p.id) <= (
                SELECT ref."paidAt", ref.id FROM payments ref WHERE ref.id = $2
              )`,
      [payment.enrollmentId, payment.id],
    );

    const amountPaid = Number(rows[0]?.total ?? 0);
    const totalDue = Number(payment.enrollment?.totalDue) || 0;

    const result = payment as PaymentResult;
    result.balanceAfter = {
      totalDue,
      amountPaid,
      balance: Math.max(totalDue - amountPaid, 0),
      isFullyPaid: totalDue > 0 && amountPaid >= totalDue,
      status: payment.enrollment?.status ?? EnrollmentStatus.PENDING_PAYMENT,
    };

    return result;
  }

  async findOneById(id: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { id },
      relations: {
        enrollment: { school: true, student: true, classRoom: true, academicYear: true },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Reçu introuvable avec l'identifiant ${id}`);
    }

    return payment;
  }

  async findOne(id: string, schoolId: string): Promise<Payment> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const payment = await this.paymentRepository.findOne({
      where: { id, schoolId },
      relations: {
        enrollment: {
          school: true,
          student: true,
          classRoom: true,
          academicYear: true,
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Reçu introuvable avec l'identifiant ${id}`);
    }

    return payment;
  }
}
