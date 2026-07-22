import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateClassRoomDto } from './dto/create-classroom.dto';
import { ClassRoom, ClassRoomLevel } from './entities/classroom.entity';

@Injectable()
export class ClassRoomsService {
  constructor(
    @InjectRepository(ClassRoom)
    private readonly classRoomRepository: Repository<ClassRoom>,
  ) {}

  async create(createClassRoomDto: CreateClassRoomDto, schoolId: string): Promise<ClassRoom> {
    const classRoom = this.classRoomRepository.create({ ...createClassRoomDto, schoolId });
    return await this.classRoomRepository.save(classRoom);
  }

  // Utilisé par le SUPER_ADMIN quand il veut voir toutes les classes
  async findAll(): Promise<ClassRoom[]> {
    return await this.classRoomRepository.find({
      order: { name: 'ASC' },
    });
  }

  // Utilisé par les directeurs/secrétaires (Fail-Closed : si pas de schoolId, on bloque)
  async findAllBySchool(schoolId: string): Promise<ClassRoom[]> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    return await this.classRoomRepository.find({
      where: { schoolId },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<ClassRoom> {
    const classRoom = await this.classRoomRepository.findOne({ where: { id } });
    if (!classRoom) {
      throw new NotFoundException(`Classe introuvable avec l'identifiant ${id}`);
    }
    return classRoom;
  }
}
