import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AbsencesModule } from '../absences/absences.module';
import { BulletinsModule } from '../bulletins/bulletins.module';
import { GradingPeriodsModule } from '../grading-periods/grading-periods.module';
import { BalanceModule } from '../common/balance/balance.module';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Grade } from '../evaluations/entities/grade.entity';
import { Payment } from '../payments/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { User } from '../users/entities/user.entity';
import { ParentStudent } from './entities/parent-student.entity';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';

/**
 * Espace parent et administration des comptes correspondants.
 *
 * Le module ne recalcule rien : solde, bulletin et absences proviennent des
 * services qui les produisent déjà pour l'école. Un parent doit lire
 * exactement le même chiffre que le guichet, sans quoi la moindre divergence
 * d'arrondi devient une contestation au comptoir.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ParentStudent,
      User,
      Student,
      Enrollment,
      Grade,
      Payment,
      School,
    ]),
    BalanceModule,
    AbsencesModule,
    BulletinsModule,
    GradingPeriodsModule,
  ],
  controllers: [ParentsController],
  providers: [ParentsService],
  exports: [ParentsService],
})
export class ParentsModule {}
