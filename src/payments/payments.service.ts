import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Payment } from './entities/payment.entity';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  /**
   * Génère un numéro de reçu de caisse unique au format REC-CODE-YY-XXXX (ex: REC-CMB-26-0001)
   */
  private async generateReceiptNumber(schoolId: string, schoolSlug: string): Promise<string> {
    const currentYearShort = new Date().getFullYear().toString().slice(-2);
    const count = await this.paymentRepository.count({ where: { schoolId } });
    const sequence = (count + 1).toString().padStart(4, '0');
    return `REC-${schoolSlug.toUpperCase()}-${currentYearShort}-${sequence}`;
  }

  /**
   * Valide l'encaissement à la caisse pour un ticket d'inscription Multi-Tenant
   */
  async processPayment(createPaymentDto: CreatePaymentDto, schoolId: string, slug: string): Promise<Payment> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const enrollment = await this.enrollmentsService.findByReference(
      schoolId,
      createPaymentDto.reference,
    );

    // 1. Vérification si déjà payé
    if (enrollment.status === EnrollmentStatus.ENROLLED) {
      throw new BadRequestException(
        `L’inscription avec la référence ${createPaymentDto.reference} a déjà été réglée à la caisse.`,
      );
    }

    // 2. Vérification de l'expiration (72h)
    const now = new Date();
    if (
      enrollment.status === EnrollmentStatus.EXPIRED ||
      enrollment.expiresAt < now
    ) {
      // Marquer automatiquement comme expiré si ce n'était pas déjà fait
      if (enrollment.status !== EnrollmentStatus.EXPIRED) {
        enrollment.status = EnrollmentStatus.EXPIRED;
        await this.enrollmentRepository.save(enrollment);
      }

      throw new BadRequestException(
        `Le jeton ${createPaymentDto.reference} a expiré (délai de 72h dépassé). Veuillez renouveler l'inscription auprès du secrétariat via l'onglet 'Les Oubliés'.`,
      );
    }

    // 3. Enregistrement du paiement et mise à jour de l'inscription vers ENROLLED
    const schoolSlug = enrollment.school ? enrollment.school.slug : 'SCH';
    const receiptNumber = await this.generateReceiptNumber(schoolId, schoolSlug);

    const payment = this.paymentRepository.create({
      enrollmentId: enrollment.id,
      amount: createPaymentDto.amount,
      receiptNumber,
      schoolId,
    });

    const savedPayment = await this.paymentRepository.save(payment);

    // Marquer l'inscription comme validée et payée
    enrollment.status = EnrollmentStatus.ENROLLED;
    await this.enrollmentRepository.save(enrollment);

    // Associer l'objet inscription pour le reçu complet
    savedPayment.enrollment = enrollment;
    return savedPayment;
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
