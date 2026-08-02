import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassRoomsController } from './classrooms.controller';
import { ClassRoomsService } from './classrooms.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { ClassRoom } from './entities/classroom.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ClassRoom, Enrollment])],
  controllers: [ClassRoomsController],
  providers: [ClassRoomsService],
  exports: [ClassRoomsService, TypeOrmModule],
})
export class ClassRoomsModule {}
