import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Counter } from './counter.entity';
import { ReferencesService } from './references.service';

@Module({
  imports: [TypeOrmModule.forFeature([Counter])],
  providers: [ReferencesService],
  exports: [ReferencesService],
})
export class CountersModule {}
