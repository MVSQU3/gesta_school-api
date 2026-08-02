import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { TeachingAssignment } from './entities/teaching-assignment.entity';
import { TeachingController } from './teaching.controller';
import { TeachingService } from './teaching.service';

@Module({
  imports: [TypeOrmModule.forFeature([TeachingAssignment, User])],
  controllers: [TeachingController],
  providers: [TeachingService],
  exports: [TeachingService],
})
export class TeachingModule {}
