import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Payment } from '../payments/entities/payment.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Enrollment, Payment, AcademicYear])],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
