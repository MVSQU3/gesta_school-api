import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';
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
    private readonly auditService: AuditService,
  ) {}

  /** Montant en FCFA, lisible dans une phrase de journal. */
  private fcfa(value: unknown): string {
    return `${Number(value ?? 0).toLocaleString('fr-FR')} FCFA`;
  }

  async create(
    createClassRoomDto: CreateClassRoomDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<ClassRoom> {
    const classRoom = this.classRoomRepository.create({ ...createClassRoomDto, schoolId });
    const saved = await this.classRoomRepository.save(classRoom);

    void this.auditService.record(
      {
        action: AuditAction.CLASSROOM_CREATED,
        entityType: 'classrooms',
        entityId: saved.id,
        schoolId,
        summary: `Classe ${saved.name} créée, tarif ${this.fcfa(saved.tuitionFee)}`,
      },
      actor,
    );

    return saved;
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
    actor?: AuthUser,
  ): Promise<ClassRoom> {
    const classRoom = await this.findOneOfSchool(id, schoolId);

    const before = {
      name: classRoom.name,
      level: classRoom.level,
      tuitionFee: Number(classRoom.tuitionFee),
    };

    Object.assign(classRoom, updateClassRoomDto);
    const saved = await this.classRoomRepository.save(classRoom);

    const after = {
      name: saved.name,
      level: saved.level,
      tuitionFee: Number(saved.tuitionFee),
    };
    const changes = this.auditService.diff(before, after);

    // Rien n'a bougé : on n'écrit pas de ligne. Un journal qui consigne les
    // enregistrements à blanc noie les vraies modifications.
    if (changes) {
      // Le tarif est mis en avant dans le résumé : c'est la modification qui
      // engage de l'argent, et celle qu'on vient chercher dans le journal.
      const summary = changes.tuitionFee
        ? `Tarif de la classe ${saved.name} porté de ${this.fcfa(before.tuitionFee)} à ${this.fcfa(after.tuitionFee)}`
        : `Classe ${before.name} modifiée (${Object.keys(changes).join(', ')})`;

      void this.auditService.record(
        {
          action: AuditAction.CLASSROOM_UPDATED,
          entityType: 'classrooms',
          entityId: saved.id,
          schoolId,
          summary,
          changes,
        },
        actor,
      );
    }

    return saved;
  }

  /**
   * Suppression d'une classe.
   *
   * Refusée dès qu'une inscription y est rattachée : la relation est en
   * ON DELETE RESTRICT côté base, et supprimer la classe reviendrait à
   * effacer la trace de ce qui a été facturé aux familles.
   */
  async remove(
    id: string,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<{ message: string }> {
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

    void this.auditService.record(
      {
        action: AuditAction.CLASSROOM_DELETED,
        entityType: 'classrooms',
        entityId: id,
        schoolId,
        summary: `Classe ${classRoom.name} supprimée (tarif ${this.fcfa(classRoom.tuitionFee)})`,
      },
      actor,
    );

    return { message: `La classe ${classRoom.name} a été supprimée.` };
  }
}
