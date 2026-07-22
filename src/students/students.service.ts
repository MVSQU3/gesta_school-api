import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateStudentDto } from './dto/create-student.dto';
import { Student } from './entities/student.entity';

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
  ) {}

  async create(createStudentDto: CreateStudentDto): Promise<Student> {
    // Conversion de la date locale JJ-MM-AAAA en Date JS/SQL
    const [day, month, year] = createStudentDto.birthDay.split(/[-/]/);
    const parsedBirthDay = new Date(Number(year), Number(month) - 1, Number(day));

    const student = this.studentRepository.create({
      firstName: createStudentDto.firstName,
      lastName: createStudentDto.lastName,
      birthDay: parsedBirthDay,
      parentPhone: createStudentDto.parentPhone,
    });

    return await this.studentRepository.save(student);
  }

  async findAll(): Promise<Student[]> {
    return await this.studentRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findAllBySchool(schoolId: string): Promise<Student[]> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    return await this.studentRepository
      .createQueryBuilder('student')
      .innerJoin('student.enrollments', 'enrollment', 'enrollment.schoolId = :schoolId', { schoolId })
      .orderBy('student.createdAt', 'DESC')
      .getMany();
  }

  async findOne(id: string): Promise<Student> {
    const student = await this.studentRepository.findOne({ where: { id } });
    if (!student) {
      throw new NotFoundException(`Élève introuvable avec l'identifiant ${id}`);
    }
    return student;
  }
}
