import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { School } from './entities/school.entity';

@Injectable()
export class SchoolsService {
  constructor(
    @InjectRepository(School)
    private readonly schoolRepository: Repository<School>,
  ) {}

  async findAll(): Promise<School[]> {
    return await this.schoolRepository.find({
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<School> {
    const school = await this.schoolRepository.findOne({ where: { id } });
    if (!school) {
      throw new NotFoundException(
        `Établissement introuvable avec l'identifiant ${id}`,
      );
    }
    return school;
  }

  async update(id: string, updateSchoolDto: UpdateSchoolDto): Promise<School> {
    const school = await this.findOne(id);

    if (updateSchoolDto.slug && updateSchoolDto.slug.toUpperCase() !== school.slug) {
      const existing = await this.schoolRepository.findOne({
        where: { slug: updateSchoolDto.slug.toUpperCase() },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Un établissement avec le code ${updateSchoolDto.slug.toUpperCase()} existe déjà.`,
        );
      }
    }

    Object.assign(school, {
      ...updateSchoolDto,
      slug: updateSchoolDto.slug ? updateSchoolDto.slug.toUpperCase() : school.slug,
    });

    return await this.schoolRepository.save(school);
  }

  async remove(id: string): Promise<{ message: string }> {
    const school = await this.findOne(id);
    await this.schoolRepository.remove(school);
    return { message: `L'établissement ${school.name} a été supprimé avec succès.` };
  }
}
