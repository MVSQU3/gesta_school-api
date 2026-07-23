import { Controller, Get, Post, Body, UseGuards, Query, Param } from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/v1/students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Roles(Role.DIRECTOR, Role.SECRETARY)
  @Post()
  create(@Body() createStudentDto: CreateStudentDto) {
    return this.studentsService.create(createStudentDto);
  }

  @Roles(Role.DIRECTOR, Role.SECRETARY)
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.studentsService.findAllBySchool(user.schoolId, academicYearId);
  }

  @Roles(Role.DIRECTOR, Role.SECRETARY)
  @Get(':studentId')
  findOneBySchool(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.studentsService.findOneBySchool(studentId, user.schoolId, academicYearId);
  }
}
