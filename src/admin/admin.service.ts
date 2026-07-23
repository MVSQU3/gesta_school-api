import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CreateSchoolDto } from "../dto/index";
import { Student, School } from "../entities/index";

@Injectable()
export class AdminService {
    constructor(
        @InjectRepository(Student)
        private readonly studentRepository: Repository<Student>,
        @InjectRepository(School)
        private readonly schoolRepository: Repository<School>,
    ) { }

    async findAllStudents(): Promise<Student[]> {
        return await this.studentRepository.find({
            order: { createdAt: 'DESC' },
        });
    }

    async findOneStudent(id: string): Promise<Student> {
        const student = await this.studentRepository.findOne({ where: { id } });
        if (!student) {
            throw new NotFoundException(`Élève introuvable avec l'identifiant ${id}`);
        }
        return student;
  }







    async createSchool(createSchoolDto: CreateSchoolDto): Promise<School> {
      const existing = await this.schoolRepository.findOne({
        where: { slug: createSchoolDto.slug.toUpperCase() },
      });
  
      if (existing) {
        throw new ConflictException(
          `Un établissement avec le code ${createSchoolDto.slug.toUpperCase()} existe déjà.`,
        );
      }
  
      const school = this.schoolRepository.create({
        ...createSchoolDto,
        slug: createSchoolDto.slug.toUpperCase(),
      });
  
      return await this.schoolRepository.save(school);
    }
}