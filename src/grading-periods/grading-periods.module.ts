import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Absence } from '../absences/entities/absence.entity';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import { School } from '../schools/entities/school.entity';
import { GradingPeriod } from './entities/grading-period.entity';
import { GradingPeriodsController } from './grading-periods.controller';
import { GradingPeriodsService } from './grading-periods.service';

@Module({
  imports: [TypeOrmModule.forFeature([GradingPeriod, School, Evaluation, Absence])],
  controllers: [GradingPeriodsController],
  providers: [GradingPeriodsService],
  exports: [GradingPeriodsService],
})
export class GradingPeriodsModule {}
