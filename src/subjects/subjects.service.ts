import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import {
  AssignSubjectDto,
  CreateSubjectDto,
  UpdateSubjectDto,
} from './dto/subject.dto';
import { ClassRoomSubject } from './entities/classroom-subject.entity';
import { Subject } from './entities/subject.entity';

@Injectable()
export class SubjectsService {
  constructor(
    @InjectRepository(Subject)
    private readonly subjectRepository: Repository<Subject>,
    @InjectRepository(ClassRoomSubject)
    private readonly classRoomSubjectRepository: Repository<ClassRoomSubject>,
    @InjectRepository(ClassRoom)
    private readonly classRoomRepository: Repository<ClassRoom>,
    @InjectRepository(Evaluation)
    private readonly evaluationRepository: Repository<Evaluation>,
  ) {}

  // ----- Matières de l'établissement -----

  async create(dto: CreateSubjectDto, schoolId: string): Promise<Subject> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const existing = await this.subjectRepository.findOne({
      where: { schoolId, name: dto.name.trim() },
    });
    if (existing) {
      throw new ConflictException(
        `La matière « ${dto.name.trim()} » existe déjà dans cet établissement.`,
      );
    }

    const subject = this.subjectRepository.create({
      schoolId,
      name: dto.name.trim(),
      shortName: dto.shortName?.trim() || null,
    });
    return await this.subjectRepository.save(subject);
  }

  async findAll(schoolId: string): Promise<Subject[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    return await this.subjectRepository.find({
      where: { schoolId },
      order: { name: 'ASC' },
    });
  }

  async findOneOfSchool(id: string, schoolId: string): Promise<Subject> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const subject = await this.subjectRepository.findOne({
      where: { id, schoolId },
    });
    if (!subject) {
      throw new NotFoundException(`Matière introuvable avec l'identifiant ${id}`);
    }
    return subject;
  }

  async update(
    id: string,
    dto: UpdateSubjectDto,
    schoolId: string,
  ): Promise<Subject> {
    const subject = await this.findOneOfSchool(id, schoolId);

    if (dto.name && dto.name.trim() !== subject.name) {
      const existing = await this.subjectRepository.findOne({
        where: { schoolId, name: dto.name.trim() },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `La matière « ${dto.name.trim()} » existe déjà dans cet établissement.`,
        );
      }
      subject.name = dto.name.trim();
    }
    if (dto.shortName !== undefined) {
      subject.shortName = dto.shortName?.trim() || null;
    }

    return await this.subjectRepository.save(subject);
  }

  /**
   * Suppression d'une matière, refusée dès qu'elle porte des évaluations :
   * les notes déjà saisies seraient emportées.
   */
  async remove(id: string, schoolId: string): Promise<{ message: string }> {
    const subject = await this.findOneOfSchool(id, schoolId);

    const evaluationCount = await this.evaluationRepository.count({
      where: { subjectId: id },
    });
    if (evaluationCount > 0) {
      throw new ConflictException(
        `La matière ${subject.name} ne peut pas être supprimée : ${evaluationCount} évaluation(s) y sont rattachées.`,
      );
    }

    await this.subjectRepository.remove(subject);
    return { message: `La matière ${subject.name} a été supprimée.` };
  }

  // ----- Programme d'une classe -----

  /** Matières enseignées dans une classe, avec leurs coefficients. */
  async findClassRoomProgram(
    classRoomId: string,
    schoolId: string,
  ): Promise<ClassRoomSubject[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    return await this.classRoomSubjectRepository.find({
      where: { classRoomId, schoolId },
      relations: { subject: true },
      order: { subject: { name: 'ASC' } },
    });
  }

  async assignToClassRoom(
    classRoomId: string,
    dto: AssignSubjectDto,
    schoolId: string,
  ): Promise<ClassRoomSubject> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const classRoom = await this.classRoomRepository.findOne({
      where: { id: classRoomId, schoolId },
    });
    if (!classRoom) {
      throw new NotFoundException(
        `Classe introuvable avec l'identifiant ${classRoomId}`,
      );
    }
    await this.findOneOfSchool(dto.subjectId, schoolId);

    const existing = await this.classRoomSubjectRepository.findOne({
      where: { classRoomId, subjectId: dto.subjectId },
    });
    if (existing) {
      throw new ConflictException(
        `Cette matière figure déjà au programme de la classe ${classRoom.name}.`,
      );
    }

    const entry = this.classRoomSubjectRepository.create({
      schoolId,
      classRoomId,
      subjectId: dto.subjectId,
      coefficient: dto.coefficient,
    });
    const saved = await this.classRoomSubjectRepository.save(entry);

    return (await this.classRoomSubjectRepository.findOne({
      where: { id: saved.id },
      relations: { subject: true },
    })) as ClassRoomSubject;
  }

  async updateCoefficient(
    id: string,
    coefficient: number,
    schoolId: string,
  ): Promise<ClassRoomSubject> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const entry = await this.classRoomSubjectRepository.findOne({
      where: { id, schoolId },
      relations: { subject: true },
    });
    if (!entry) {
      throw new NotFoundException(
        `Aucune matière au programme avec l'identifiant ${id}`,
      );
    }
    entry.coefficient = coefficient;
    return await this.classRoomSubjectRepository.save(entry);
  }

  async removeFromClassRoom(
    id: string,
    schoolId: string,
  ): Promise<{ message: string }> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    const entry = await this.classRoomSubjectRepository.findOne({
      where: { id, schoolId },
      relations: { subject: true, classRoom: true },
    });
    if (!entry) {
      throw new NotFoundException(
        `Aucune matière au programme avec l'identifiant ${id}`,
      );
    }

    const evaluationCount = await this.evaluationRepository.count({
      where: { classRoomId: entry.classRoomId, subjectId: entry.subjectId },
    });
    if (evaluationCount > 0) {
      throw new ConflictException(
        `${entry.subject.name} ne peut pas être retirée du programme de ${entry.classRoom.name} : ${evaluationCount} évaluation(s) y sont rattachées.`,
      );
    }

    await this.classRoomSubjectRepository.remove(entry);
    return {
      message: `${entry.subject.name} a été retirée du programme de ${entry.classRoom.name}.`,
    };
  }
}
