import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { ClassRoomSubject } from '../subjects/entities/classroom-subject.entity';
import { TeachingModule } from '../teaching/teaching.module';
import { Evaluation } from './entities/evaluation.entity';
import { Grade } from './entities/grade.entity';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Evaluation,
      Grade,
      GradingPeriod,
      ClassRoomSubject,
      Enrollment,
    ]),
    TeachingModule,
  ],
  controllers: [EvaluationsController],
  providers: [EvaluationsService],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
