import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { CreateClassRoomDto } from './dto/create-classroom.dto';
import { UpdateClassRoomDto } from './dto/update-classroom.dto';
import { ClassRoom } from './entities/classroom.entity';

@Injectable()
export class ClassRoomsService {
  constructor(
    @InjectRepository(ClassRoom)
    private readonly classRoomRepository: Repository<ClassRoom>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
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

  /** Charge une classe en vérifiant qu'elle appartient bien à l'école. */
  private async findOneOfSchool(id: string, schoolId: string): Promise<ClassRoom> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const classRoom = await this.classRoomRepository.findOne({
      where: { id, schoolId },
    });
    if (!classRoom) {
      throw new NotFoundException(`Classe introuvable avec l'identifiant ${id}`);
    }
    return classRoom;
  }

  /**
   * Modification d'une classe.
   *
   * Une révision du tarif ne s'applique qu'aux futures inscriptions : les
   * dossiers déjà ouverts conservent le montant figé à leur création.
   */
  async update(
    id: string,
    updateClassRoomDto: UpdateClassRoomDto,
    schoolId: string,
  ): Promise<ClassRoom> {
    const classRoom = await this.findOneOfSchool(id, schoolId);
    Object.assign(classRoom, updateClassRoomDto);
    return await this.classRoomRepository.save(classRoom);
  }

  /**
   * Suppression d'une classe.
   *
   * Refusée dès qu'une inscription y est rattachée : la relation est en
   * ON DELETE RESTRICT côté base, et supprimer la classe reviendrait à
   * effacer la trace de ce qui a été facturé aux familles.
   */
  async remove(id: string, schoolId: string): Promise<{ message: string }> {
    const classRoom = await this.findOneOfSchool(id, schoolId);

    const enrollmentCount = await this.enrollmentRepository.count({
      where: { classRoomId: id },
    });

    if (enrollmentCount > 0) {
      throw new ConflictException(
        `La classe ${classRoom.name} ne peut pas être supprimée : ${enrollmentCount} inscription(s) y sont rattachées. Vous pouvez en modifier le nom ou le tarif.`,
      );
    }

    await this.classRoomRepository.remove(classRoom);
    return { message: `La classe ${classRoom.name} a été supprimée.` };
  }
}
