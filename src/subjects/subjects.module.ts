import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import { ClassRoomSubject } from './entities/classroom-subject.entity';
import { Subject } from './entities/subject.entity';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subject, ClassRoomSubject, ClassRoom, Evaluation]),
  ],
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService],
})
export class SubjectsModule {}
