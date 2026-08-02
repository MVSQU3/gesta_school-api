import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { AdminService } from './admin.service';
import { Role } from 'src/common/enums/role.enum';
import { School, Student, User } from '../entities/index';
import { CreateSchoolDto, CreateStudentDto, CreateUserDto } from '../dto/index';
import { Roles } from 'src/common/decorators/roles.decorator';

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) { }


  // ----- STUDENTS -----

  @Roles(Role.SUPER_ADMIN)
  @Post('create-student')
  async createStudent(
    @Body() createStudentDto: CreateStudentDto,
    @Query('schoolId') schoolId?: string,
  ): Promise<Student> {
    // L'élève est désormais rattaché à un établissement : l'admin, qui n'en a
    // aucun dans son jeton, doit obligatoirement préciser lequel.
    if (!schoolId) {
      throw new BadRequestException(
        "L'école cible (schoolId) doit être précisée pour enregistrer un élève.",
      );
    }
    return await this.adminService.createStudent(createStudentDto, schoolId);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get('students')
  findAllStudents() {
    return this.adminService.findAllStudents();
  }
  
  @Roles(Role.SUPER_ADMIN)
  @Get('students/:id')
  findOneStudent(@Param('id') id: string) {
    return this.adminService.findOneStudent(id);
  }
  

  
  // ----- SCHOOLS -----
  
  @Roles(Role.SUPER_ADMIN)
  @Get('schools')
  findAllSchool() {
    return this.adminService.findAllSchool();
  }

  @Roles(Role.SUPER_ADMIN)
  @Get('schools/:id')
  findOneSchool(@Param('id') id: string) {
    return this.adminService.findOneSchool(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('create-school')
  async createSchool(@Body() createSchoolDto: CreateSchoolDto): Promise<School> {
    return await this.adminService.createSchool(createSchoolDto);
  }


  // ----- USERS (staff) -----

  /**
   * Création d'un utilisateur staff (directeur, secrétaire, comptable) pour une école spécifique.
   * L'admin doit obligatoirement fournir schoolId dans le body.
   */
  @Roles(Role.SUPER_ADMIN)
  @Post('create-user')
  async createUser(@Body() createUserDto: CreateUserDto): Promise<User> {
    return await this.adminService.createUser(createUserDto);
  }

  /**
   * Liste tous les utilisateurs staff (directeurs, secrétaires, comptables)
   */
  @Roles(Role.SUPER_ADMIN)
  @Get('users')
  findAllUsers() {
    return this.adminService.findAllUsers();
  }

  /**
   * Liste uniquement les directeurs
   */
  @Roles(Role.SUPER_ADMIN)
  @Get('directors')
  findAllDirectors() {
    return this.adminService.findAllDirectors();
  }
}
