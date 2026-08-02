import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../payments/entities/payment.entity';
import { BalanceService } from './balance.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
