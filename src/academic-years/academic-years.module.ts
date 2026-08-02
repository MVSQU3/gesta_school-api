import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYearsController } from './academic-years.controller';
import { AcademicYearsService } from './academic-years.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriodsModule } from '../grading-periods/grading-periods.module';
import { AcademicYear } from './entities/academic-year.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AcademicYear, Enrollment]), GradingPeriodsModule],
  controllers: [AcademicYearsController],
  providers: [AcademicYearsService],
  exports: [AcademicYearsService, TypeOrmModule],
})
export class AcademicYearsModule {}
