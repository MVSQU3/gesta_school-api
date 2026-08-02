import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { resolveSchoolId } from '../common/utils/resolve-school';
import {
  AssignSubjectDto,
  CreateSubjectDto,
  UpdateCoefficientDto,
  UpdateSubjectDto,
} from './dto/subject.dto';
import { ClassRoomSubject } from './entities/classroom-subject.entity';
import { Subject } from './entities/subject.entity';
import { SubjectsService } from './subjects.service';

@Controller('api/v1/subjects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubjectsController {
  constructor(private readonly service: SubjectsService) {}

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Subject[]> {
    return await this.service.findAll(resolveSchoolId(user, querySchoolId));
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post()
  async create(
    @Body() dto: CreateSubjectDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Subject> {
    return await this.service.create(dto, resolveSchoolId(user, querySchoolId));
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<Subject> {
    return await this.service.update(id, dto, resolveSchoolId(user, querySchoolId));
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    return await this.service.remove(id, resolveSchoolId(user, querySchoolId));
  }

  // ----- Programme d'une classe : matières et coefficients -----

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.TEACHER)
  @Get('classroom/:classRoomId')
  async findProgram(
    @Param('classRoomId') classRoomId: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ClassRoomSubject[]> {
    return await this.service.findClassRoomProgram(
      classRoomId,
      resolveSchoolId(user, querySchoolId),
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post('classroom/:classRoomId')
  async assign(
    @Param('classRoomId') classRoomId: string,
    @Body() dto: AssignSubjectDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ClassRoomSubject> {
    return await this.service.assignToClassRoom(
      classRoomId,
      dto,
      resolveSchoolId(user, querySchoolId),
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch('program/:id')
  async updateCoefficient(
    @Param('id') id: string,
    @Body() dto: UpdateCoefficientDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ClassRoomSubject> {
    return await this.service.updateCoefficient(
      id,
      dto.coefficient,
      resolveSchoolId(user, querySchoolId),
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete('program/:id')
  async removeFromProgram(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    return await this.service.removeFromClassRoom(
      id,
      resolveSchoolId(user, querySchoolId),
    );
  }
}
