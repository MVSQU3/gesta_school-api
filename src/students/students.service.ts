import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateStudentDto } from './dto/create-student.dto';
import { Student } from './entities/student.entity';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepository: Repository<AcademicYear>,
  ) {}

  /**
   * Résout l'ID de l'année scolaire à utiliser :
   * - Si un academicYearId est fourni par le frontend (filtre page dédiée) → on l'utilise
   * - Sinon → on cherche l'année active (isActive: true) pour cette école
   */
  private async resolveAcademicYearId(
    schoolId: string,
    academicYearId?: string,
  ): Promise<string> {
    if (academicYearId) {
      return academicYearId;
    }

    const activeYear = await this.academicYearRepository.findOne({
      where: { schoolId, isActive: true },
    });

    if (!activeYear) {
      throw new NotFoundException(
        "Aucune année scolaire active n'a été configurée pour cet établissement.",
      );
    }

    return activeYear.id;
  }

  async create(createStudentDto: CreateStudentDto): Promise<Student> {
    // Conversion de la date locale JJ-MM-AAAA en Date JS/SQL
    const [day, month, year] = createStudentDto.birthDay.split(/[-/]/);
    const parsedBirthDay = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
    );

    const student = this.studentRepository.create({
      firstName: createStudentDto.firstName,
      lastName: createStudentDto.lastName,
      birthDay: parsedBirthDay,
      parentPhone: createStudentDto.parentPhone,
    });

    return await this.studentRepository.save(student);
  }

  async findAllBySchool(
    schoolId: string,
    academicYearId?: string,
  ): Promise<Student[]> {
    if (typeof schoolId !== 'string' || schoolId.trim() === '') {
      throw new UnauthorizedException('Accès refusé.');
    }

    const resolvedYearId = await this.resolveAcademicYearId(
      schoolId,
      academicYearId,
    );

    return await this.studentRepository
      .createQueryBuilder('student')
      .innerJoin(
        'student.enrollments',
        'enrollment',
        'enrollment.schoolId = :schoolId AND enrollment.academicYearId = :resolvedYearId',
        { schoolId, resolvedYearId },
      )
      .orderBy('student.createdAt', 'DESC')
      .getMany();
  }

  async findOneBySchool(
    studentId: string,
    schoolId: string,
    academicYearId?: string,
  ) {
    if (
      typeof studentId !== 'string' ||
      studentId.trim() === '' ||
      typeof schoolId !== 'string' ||
      schoolId.trim() === ''
    ) {
      throw new UnauthorizedException('Accès refusé.');
    }

    const resolvedYearId = await this.resolveAcademicYearId(
      schoolId,
      academicYearId,
    );

    const student = await this.studentRepository
      .createQueryBuilder('student')
      .select([
        'student.id',
        'student.firstName',
        'student.lastName',
        'student.birthDay',
        'student.parentPhone',
      ])
      .addSelect([
        'enrollment.id',
        'enrollment.classRoomId',
        'enrollment.academicYearId',
        'enrollment.status',
        'enrollment.reference',
      ])
      .innerJoin(
        'student.enrollments',
        'enrollment',
        'enrollment.schoolId = :schoolId AND enrollment.academicYearId = :resolvedYearId',
        { schoolId, resolvedYearId },
      )
      .where('student.id = :studentId', { studentId })
      .getOne();

    if (!student) {
      throw new NotFoundException(
        `Élève introuvable avec l'identifiant ${studentId}`,
      );
    }
    return student;
  }
}
