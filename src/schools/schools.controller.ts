import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { School } from './entities/school.entity';
import { SchoolsService } from './schools.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/v1/schools')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Roles(Role.SUPER_ADMIN)
  @Post()
  async create(@Body() createSchoolDto: CreateSchoolDto): Promise<School> {
    return await this.schoolsService.create(createSchoolDto);
  }

  @Get()
  async findAll(@CurrentUser() user: AuthUser): Promise<School | School[]> {
    if (user.roles.includes(Role.SUPER_ADMIN)) {
      return await this.schoolsService.findAll();
    }
    return await this.schoolsService.findOne(user.schoolId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<School> {
    if (!user.roles.includes(Role.SUPER_ADMIN) && user.schoolId !== id) {
      throw new ForbiddenException(
        'Vous ne pouvez pas accéder aux informations de cette école.',
      );
    }
    return await this.schoolsService.findOne(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateSchoolDto: UpdateSchoolDto,
  ): Promise<School> {
    return await this.schoolsService.update(id, updateSchoolDto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return await this.schoolsService.remove(id);
  }
}
