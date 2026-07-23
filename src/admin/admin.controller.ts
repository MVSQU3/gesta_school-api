import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { AdminService } from './admin.service';
import { Role } from 'src/common/enums/role.enum';
import { School } from '../entities/index';
import { CreateSchoolDto } from '../dto/index';
import { Roles } from 'src/common/decorators/roles.decorator';

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('students')
  findAllStudents() {
    return this.adminService.findAllStudents();
  }

  @Get('students/:id')
  findOneStudent(@Param('id') id: string) {
    return this.adminService.findOneStudent(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('create-school')
  async create(@Body() createSchoolDto: CreateSchoolDto): Promise<School> {
    return await this.adminService.createSchool(createSchoolDto);
  }
}
