import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import { ClassRoomsService } from './classrooms.service';
import { CreateClassRoomDto } from './dto/create-classroom.dto';
import { UpdateClassRoomDto } from './dto/update-classroom.dto';
import { ClassRoom } from './entities/classroom.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/v1/classrooms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassRoomsController {
  constructor(private readonly classRoomsService: ClassRoomsService) {}

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Post()
  async create(
    @Body() createClassRoomDto: CreateClassRoomDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ClassRoom> {
    return await this.classRoomsService.create(
      createClassRoomDto,
      user.schoolId,
      user,
    );
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.ACCOUNTANT)
  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ClassRoom[]> {
    if (user.roles.includes(Role.SUPER_ADMIN) && !querySchoolId) {
      return await this.classRoomsService.findAll();
    }

    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    
    if (!schoolId) {
      throw new ForbiddenException("Accès refusé : aucune école valide assignée.");
    }

    return await this.classRoomsService.findAllBySchool(schoolId);
  }

  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.ACCOUNTANT)
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ClassRoom> {
    return await this.classRoomsService.findOne(id);
  }

  /**
   * Modification d'une classe (nom, niveau, frais de scolarité).
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateClassRoomDto: UpdateClassRoomDto,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<ClassRoom> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.classRoomsService.update(id, updateClassRoomDto, schoolId, user);
  }

  /**
   * Suppression d'une classe, refusée si des inscriptions y sont rattachées.
   */
  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('schoolId') querySchoolId?: string,
  ): Promise<{ message: string }> {
    const schoolId = user.roles.includes(Role.SUPER_ADMIN) ? querySchoolId : user.schoolId;
    if (!schoolId) throw new ForbiddenException("Accès refusé : aucune école spécifiée.");
    return await this.classRoomsService.remove(id, schoolId, user);
  }
}
