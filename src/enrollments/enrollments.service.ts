import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { School } from '../schools/entities/school.entity';
import { StudentsService } from '../students/students.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { Enrollment, EnrollmentStatus } from './entities/enrollment.entity';

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentRepository: Repository<Enrollment>,
    @InjectRepository(School)
    private readonly schoolRepository: Repository<School>,
    private readonly studentsService: StudentsService,
  ) {}

  /**
   * Génère une référence séquentielle unique au format INS-CODE-YY-XXXX (ex: INS-CMB-26-0001)
   */
  private async generateReference(schoolId: string): Promise<string> {
    const school = await this.schoolRepository.findOne({
      where: { id: schoolId },
    });
    const schoolSlug = school ? school.slug.toUpperCase() : 'SCH';
    const currentYearShort = new Date().getFullYear().toString().slice(-2);

    const count = await this.enrollmentRepository.count({
      where: { schoolId },
    });
    const sequence = (count + 1).toString().padStart(4, '0');
    return `INS-${schoolSlug}-${currentYearShort}-${sequence}`;
  }

  /**
   * Calcule la date d'expiration exacte à 72 heures à partir de maintenant
   */
  private calculate72HoursExpiration(): Date {
    return new Date(Date.now() + 72 * 60 * 60 * 1000);
  }

  /**
   * Récupère une inscription complète avec toutes ses relations (Student, School, ClassRoom, AcademicYear)
   */
  async findOne(id: string): Promise<Enrollment> {
    const enrollment = await this.enrollmentRepository.findOne({
      where: { id },
      relations: {
        school: true,
        student: true,
        classRoom: true,
        academicYear: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Aucune inscription trouvée avec l'identifiant ${id}`,
      );
    }

    return enrollment;
  }

  /**
   * Crée une nouvelle inscription Multi-Tenant avec génération du Jeton Numérique 72h
   */
  async create(createEnrollmentDto: CreateEnrollmentDto): Promise<Enrollment> {
    let studentId = createEnrollmentDto.studentId;

    // Si les données complètes de l'élève sont fournies, on le crée d'abord
    if (!studentId && createEnrollmentDto.studentData) {
      const newStudent = await this.studentsService.create(
        createEnrollmentDto.studentData,
      );
      studentId = newStudent.id;
    }

    if (!studentId) {
      throw new BadRequestException(
        'Veuillez fournir un studentId ou les données studentData complètes pour enregistrer l’élève.',
      );
    }

    const reference = await this.generateReference(
      createEnrollmentDto.schoolId,
    );
    const expiresAt = this.calculate72HoursExpiration();

    const enrollment = this.enrollmentRepository.create({
      schoolId: createEnrollmentDto.schoolId,
      studentId,
      classRoomId: createEnrollmentDto.classRoomId,
      academicYearId: createEnrollmentDto.academicYearId,
      reference,
      status: EnrollmentStatus.PENDING_PAYMENT,
      expiresAt,
    });

    const saved = await this.enrollmentRepository.save(enrollment);

    // Retourner l'inscription rechargée avec l'élève et ses coordonnées
    return await this.findOne(saved.id);
  }

  async findAllExpired(): Promise<Enrollment[]> {
    const now = new Date();
    const updateQuery: any = {
      status: EnrollmentStatus.PENDING_PAYMENT,
      expiresAt: LessThan(now),
    };
    await this.enrollmentRepository.update(updateQuery, {
      status: EnrollmentStatus.EXPIRED,
    });
    return await this.enrollmentRepository.find({
      where: { status: EnrollmentStatus.EXPIRED },
      relations: { school: true, student: true, classRoom: true, academicYear: true },
      order: { expiresAt: 'DESC' },
    });
  }

  /**
   * Récupère la liste de tous les dossiers expirés d'une école (Onglet "Les Oubliés")
   */
  async findExpired(schoolId: string): Promise<Enrollment[]> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const now = new Date();

    // Mettre à jour automatiquement en base les dossiers dépassés qui n'ont pas encore basculé
    const updateQuery: any = {
      status: EnrollmentStatus.PENDING_PAYMENT,
      expiresAt: LessThan(now),
      schoolId,
    };

    await this.enrollmentRepository.update(updateQuery, {
      status: EnrollmentStatus.EXPIRED,
    });

    const whereQuery: any = { status: EnrollmentStatus.EXPIRED, schoolId };

    return await this.enrollmentRepository.find({
      where: whereQuery,
      relations: {
        school: true,
        student: true,
        classRoom: true,
        academicYear: true,
      },
      order: { expiresAt: 'DESC' },
    });
  }

  /**
   * LE CLONAGE FANTÔME 👻
   * Écrase l'ancienne référence par une nouvelle (ex: INS-CMB-26-0002),
   * réinitialise le délai à +72h, et repasse le statut à PENDING_PAYMENT.
   */
  async renew(id: string, schoolId: string): Promise<Enrollment> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const enrollment = await this.findOne(id);

    if (enrollment.schoolId !== schoolId) {
      throw new BadRequestException(
        `Vous n'êtes pas autorisé à modifier cette inscription.`,
      );
    }

    const now = new Date();
    const isExpired =
      enrollment.status === EnrollmentStatus.EXPIRED ||
      enrollment.expiresAt < now;

    if (!isExpired) {
      throw new BadRequestException(
        `Le dossier ${enrollment.reference} est encore valide et ne nécessite pas de renouvellement.`,
      );
    }

    // Clonage fantôme Multi-Tenant: Nouvelle référence personnalisée + Reset 72h
    const newReference = await this.generateReference(enrollment.schoolId);
    const newExpiresAt = this.calculate72HoursExpiration();

    enrollment.reference = newReference;
    enrollment.expiresAt = newExpiresAt;
    enrollment.status = EnrollmentStatus.PENDING_PAYMENT;

    const saved = await this.enrollmentRepository.save(enrollment);

    return await this.findOne(saved.id);
  }

  async findByReference(
    schoolId: string,
    reference: string,
  ): Promise<Enrollment> {
    if (!schoolId) throw new (await import('@nestjs/common')).ForbiddenException('schoolId est requis');
    const school = await this.schoolRepository.findOne({
      where: { id: schoolId },
    });
    if (!school) {
      throw new NotFoundException(`Aucune école trouvée`);
    }

    const enrollment = await this.enrollmentRepository.findOne({
      where: { reference, schoolId },
      relations: {
        school: true,
        student: true,
        classRoom: true,
        academicYear: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Aucune inscription trouvée pour la référence ${reference}`,
      );
    }

    return enrollment;
  }
}
