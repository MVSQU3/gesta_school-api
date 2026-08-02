import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceModule } from '../common/balance/balance.module';
import { CountersModule } from '../common/counters/counters.module';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { School } from '../schools/entities/school.entity';
import { Payment } from './entities/payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Enrollment, School]),
    CountersModule,
    BalanceModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService, TypeOrmModule],
})
export class PaymentsModule {}
