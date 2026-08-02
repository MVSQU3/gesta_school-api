import { Body, Controller, Get, Param, Patch, Post, Res, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { PdfService } from '../common/pdf/pdf.service';
import { buildReceiptPdf } from './receipt.pdf';
import { CancelPaymentDto } from './dto/cancel-payment.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { Payment } from './entities/payment.entity';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/v1/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Validation de l'encaissement à la caisse et passage au statut ENROLLED
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.ACCOUNTANT)
  @Post()
  async processPayment(
    @Body() createPaymentDto: CreatePaymentDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Payment> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.paymentsService.processPayment(
      createPaymentDto,
      schoolId,
      user.slug || 'SCH',
      user.id,
    );
  }

  /**
   * Journal de caisse : versements d'une période avec les totaux consolidés.
   * Sans dates, la journée en cours est retournée (clôture de caisse du jour).
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.ACCOUNTANT)
  @Get()
  async findJournal(
    @Query() query: QueryPaymentsDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.paymentsService.findJournal(schoolId, query);
  }

  /**
   * Réimpression : retrouve un reçu archivé par son numéro.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.ACCOUNTANT, Role.SECRETARY)
  @Get('receipt/:receiptNumber')
  async findByReceiptNumber(
    @Param('receiptNumber') receiptNumber: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ) {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException('Accès refusé');
    return await this.paymentsService.findByReceiptNumber(receiptNumber, schoolId);
  }

  /**
   * Reçu au format PDF, prêt à être imprimé ou envoyé à la famille.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.ACCOUNTANT, Role.SECRETARY)
  @Get('receipt/:receiptNumber/pdf')
  async receiptPdf(
    @Param('receiptNumber') receiptNumber: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<void> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException('Accès refusé');

    const payment = await this.paymentsService.findByReceiptNumber(
      receiptNumber,
      schoolId,
    );
    const pdf = await this.pdfService.render(buildReceiptPdf(payment));

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="recu-${payment.receiptNumber}.pdf"`,
      'Content-Length': pdf.length.toString(),
    });
    res.end(pdf);
  }

  /**
   * Annulation d'un encaissement (erreur de saisie ou remboursement).
   *
   * Réservée à la direction : le caissier qui a encaissé ne peut pas défaire
   * lui-même son opération.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelPaymentDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Payment> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.paymentsService.cancel(id, dto, schoolId, user.id);
  }

  /**
   * Historique des versements d'une inscription (échéancier)
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.ACCOUNTANT, Role.SECRETARY)
  @Get('enrollment/:enrollmentId')
  async findByEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Payment[]> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException('Accès refusé');
    return await this.paymentsService.findByEnrollment(enrollmentId, schoolId);
  }

  /**
   * Récupération des détails d'un reçu de paiement par son ID
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.ACCOUNTANT, Role.SECRETARY)
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Payment> {
    if (user.roles.includes(Role.SUPER_ADMIN) && !querySchoolId) {
      return await this.paymentsService.findOneById(id);
    }
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé");
    return await this.paymentsService.findOne(id, schoolId);
  }
}
