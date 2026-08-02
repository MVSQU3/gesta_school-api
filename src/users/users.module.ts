import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

import { UsersController } from './users.controller';
import { School } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([User, School])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }
