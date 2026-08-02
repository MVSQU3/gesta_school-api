import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { TeachingAssignment } from './entities/teaching-assignment.entity';

@Injectable()
export class TeachingService {
  constructor(
    @InjectRepository(TeachingAssignment)
    private readonly assignmentRepository: Repository<TeachingAssignment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(
    dto: CreateAssignmentDto,
    schoolId: string,
  ): Promise<TeachingAssignment> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const teacher = await this.userRepository.findOne({
      where: { id: dto.teacherId, schoolId },
    });
    if (!teacher) {
      throw new NotFoundException(
        `Aucun employé trouvé avec l'identifiant ${dto.teacherId} dans cet établissement.`,
      );
    }
    if (!teacher.roles.includes(Role.TEACHER)) {
      throw new ConflictException(
        `${teacher.email} n'a pas le rôle Enseignant : attribuez-le lui avant de l'affecter à une classe.`,
      );
    }

    const existing = await this.assignmentRepository.findOne({
      where: {
        teacherId: dto.teacherId,
        classRoomId: dto.classRoomId,
        subjectId: dto.subjectId,
        academicYearId: dto.academicYearId,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Cet enseignant est déjà affecté à cette matière dans cette classe pour cette année.',
      );
    }

    const assignment = this.assignmentRepository.create({ ...dto, schoolId });
    const saved = await this.assignmentRepository.save(assignment);
    return await this.findOneOfSchool(saved.id, schoolId);
  }

  async findOneOfSchool(
    id: string,
    schoolId: string,
  ): Promise<TeachingAssignment> {
    const assignment = await this.assignmentRepository.findOne({
      where: { id, schoolId },
      relations: { teacher: true, classRoom: true, subject: true, academicYear: true },
    });
    if (!assignment) {
      throw new NotFoundException(`Affectation introuvable (${id})`);
    }
    return assignment;
  }

  /**
   * Affectations de l'établissement, filtrables par enseignant, classe ou année.
   */
  async findAll(
    schoolId: string,
    filters: {
      teacherId?: string;
      classRoomId?: string;
      academicYearId?: string;
    } = {},
  ): Promise<TeachingAssignment[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    // Les filtres non renseignés doivent être retirés : TypeORM rejette une
    // valeur `undefined` dans une clause where plutôt que de l'ignorer.
    const where: Record<string, string> = { schoolId };
    for (const [key, value] of Object.entries(filters)) {
      if (value) where[key] = value;
    }

    return await this.assignmentRepository.find({
      where,
      relations: { teacher: true, classRoom: true, subject: true, academicYear: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Vérifie qu'un enseignant est bien affecté à une matière dans une classe
   * pour une année donnée.
   *
   * C'est le contrôle central du module de notation : sans affectation, un
   * enseignant ne peut ni créer d'évaluation ni saisir de note. Les directeurs
   * et administrateurs ne sont pas soumis à ce contrôle.
   */
  async isAssigned(
    teacherId: string,
    classRoomId: string,
    subjectId: string,
    academicYearId: string,
  ): Promise<boolean> {
    const count = await this.assignmentRepository.count({
      where: { teacherId, classRoomId, subjectId, academicYearId },
    });
    return count > 0;
  }

  async remove(id: string, schoolId: string): Promise<{ message: string }> {
    const assignment = await this.findOneOfSchool(id, schoolId);
    await this.assignmentRepository.remove(assignment);
    return {
      message: `${assignment.teacher.email} n'enseigne plus ${assignment.subject.name} en ${assignment.classRoom.name}.`,
    };
  }
}
