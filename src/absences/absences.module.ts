import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { ScheduleEntry } from '../schedule/entities/schedule-entry.entity';
import { AbsencesController } from './absences.controller';
import { AbsencesService } from './absences.service';
import { Absence } from './entities/absence.entity';
import { RollCall } from './entities/roll-call.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Absence,
      RollCall,
      Enrollment,
      GradingPeriod,
      ScheduleEntry,
    ]),
  ],
  controllers: [AbsencesController],
  providers: [AbsencesService],
  exports: [AbsencesService],
})
export class AbsencesModule {}
