import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { TeachingAssignment } from '../teaching/entities/teaching-assignment.entity';
import { ScheduleEntry } from './entities/schedule-entry.entity';
import { TimeSlot } from './entities/time-slot.entity';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TimeSlot,
      ScheduleEntry,
      TeachingAssignment,
      AcademicYear,
    ]),
  ],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
