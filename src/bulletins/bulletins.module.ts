import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AbsencesModule } from '../absences/absences.module';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import { Grade } from '../evaluations/entities/grade.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { ClassRoomSubject } from '../subjects/entities/classroom-subject.entity';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { School } from '../schools/entities/school.entity';
import { BulletinsController } from './bulletins.controller';
import { BulletinsService } from './bulletins.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Enrollment,
      Evaluation,
      Grade,
      ClassRoomSubject,
      GradingPeriod,
      School,
      ClassRoom,
      AcademicYear,
    ]),
    AbsencesModule,
  ],
  controllers: [BulletinsController],
  providers: [BulletinsService],
  exports: [BulletinsService],
})
export class BulletinsModule {}
