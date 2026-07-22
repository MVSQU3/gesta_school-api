import { Body, Controller, Get, Param, Post, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
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
  constructor(private readonly paymentsService: PaymentsService) {}

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
    return await this.paymentsService.processPayment(createPaymentDto, schoolId, user.slug || 'SCH');
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
