import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassRoomsController } from './classrooms.controller';
import { ClassRoomsService } from './classrooms.service';
import { ClassRoom } from './entities/classroom.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ClassRoom])],
  controllers: [ClassRoomsController],
  providers: [ClassRoomsService],
  exports: [ClassRoomsService, TypeOrmModule],
})
export class ClassRoomsModule {}
