import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { ExpirationCronService } from './expiration-cron.service';

@Module({
  imports: [TypeOrmModule.forFeature([Enrollment])],
  providers: [ExpirationCronService],
})
export class CronModule {}
