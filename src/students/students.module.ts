import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Student } from './entities/student.entity';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { AbsencesModule } from '../absences/absences.module';
import { BalanceModule } from '../common/balance/balance.module';
import { BulletinsModule } from '../bulletins/bulletins.module';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { Payment } from '../payments/entities/payment.entity';
import { StudentHistoryService } from './student-history.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Student,
      AcademicYear,
      Enrollment,
      Payment,
      GradingPeriod,
    ]),
    BalanceModule,
    BulletinsModule,
    AbsencesModule,
  ],
  controllers: [StudentsController],
  providers: [StudentsService, StudentHistoryService],
  exports: [StudentsService, StudentHistoryService, TypeOrmModule],
})
export class StudentsModule {}
