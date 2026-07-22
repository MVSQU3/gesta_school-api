import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { AcademicYear } from './entities/academic-year.entity';

@Injectable()
export class AcademicYearsService {
  constructor(
    @InjectRepository(AcademicYear)
    private readonly academicYearRepository: Repository<AcademicYear>,
  ) {}

  async create(
    createAcademicYearDto: CreateAcademicYearDto,
    schoolId: string,
  ): Promise<AcademicYear> {
    const academicYear = this.academicYearRepository.create({ ...createAcademicYearDto, schoolId });
    return await this.academicYearRepository.save(academicYear);
  }

  async findAll(): Promise<AcademicYear[]> {
    return await this.academicYearRepository.find({
      order: { label: 'DESC' },
    });
  }

  async findAllBySchool(schoolId: string): Promise<AcademicYear[]> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    return await this.academicYearRepository.find({
      where: { schoolId },
      order: { label: 'DESC' },
    });
  }

  async findActiveBySchool(schoolId: string): Promise<AcademicYear> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const activeYear = await this.academicYearRepository.findOne({
      where: { isActive: true, schoolId },
    });
    if (!activeYear) {
      throw new NotFoundException('Aucune année académique active n’a été configurée.');
    }
    return activeYear;
  }
}
