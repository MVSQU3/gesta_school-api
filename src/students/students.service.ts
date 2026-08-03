import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { Student } from './entities/student.entity';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepository: Repository<AcademicYear>,
  ) {}

  /**
   * Résout l'ID de l'année scolaire à utiliser :
   * - Si un academicYearId est fourni par le frontend (filtre page dédiée) → on l'utilise
   * - Sinon → on cherche l'année active (isActive: true) pour cette école
   */
  private async resolveAcademicYearId(
    schoolId: string,
    academicYearId?: string,
  ): Promise<string> {
    if (academicYearId) {
      return academicYearId;
    }

    const activeYear = await this.academicYearRepository.findOne({
      where: { schoolId, isActive: true },
    });

    if (!activeYear) {
      throw new NotFoundException(
        "Aucune année scolaire active n'a été configurée pour cet établissement.",
      );
    }

    return activeYear.id;
  }

  /** Convertit la date locale JJ-MM-AAAA (ou JJ/MM/AAAA) en Date JS/SQL. */
  private parseBirthDay(birthDay: string): Date {
    const [day, month, year] = birthDay.split(/[-/]/);
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  /**
   * Recherche un élève déjà enregistré dans l'établissement, sur la base du
   * triplet nom + prénom + date de naissance.
   *
   * Sert à éviter qu'une réinscription ne crée une seconde fiche pour le même
   * enfant, ce qui ferait perdre son historique d'une année sur l'autre.
   * La comparaison des noms est insensible à la casse et aux espaces de bord.
   */
  async findDuplicate(
    schoolId: string,
    firstName: string,
    lastName: string,
    birthDay: string,
  ): Promise<Student | null> {
    return await this.studentRepository
      .createQueryBuilder('student')
      .where('student.schoolId = :schoolId', { schoolId })
      .andWhere('LOWER(TRIM(student.firstName)) = :firstName', {
        firstName: firstName.trim().toLowerCase(),
      })
      .andWhere('LOWER(TRIM(student.lastName)) = :lastName', {
        lastName: lastName.trim().toLowerCase(),
      })
      .andWhere('student.birthDay = :birthDay', {
        birthDay: this.parseBirthDay(birthDay),
      })
      .getOne();
  }

  /** Charge un élève en vérifiant qu'il appartient bien à l'établissement. */
  async findOneOfSchool(
    studentId: string,
    schoolId: string,
  ): Promise<Student | null> {
    if (!schoolId) throw new UnauthorizedException('Accès refusé.');
    return await this.studentRepository.findOne({
      where: { id: studentId, schoolId },
    });
  }

  /**
   * Recherche libre d'un élève de l'établissement, par nom, prénom ou
   * téléphone du parent. Utilisée au secrétariat pour retrouver un élève
   * déjà connu plutôt que d'en ressaisir un nouveau.
   */
  async search(schoolId: string, query: string): Promise<Student[]> {
    if (!schoolId) throw new UnauthorizedException('Accès refusé.');

    const term = query?.trim();
    if (!term || term.length < 2) return [];

    return await this.studentRepository
      .createQueryBuilder('student')
      .where('student.schoolId = :schoolId', { schoolId })
      .andWhere(
        `(LOWER(student."firstName") LIKE :term
          OR LOWER(student."lastName") LIKE :term
          OR student."parentPhone" LIKE :term)`,
        { term: `%${term.toLowerCase()}%` },
      )
      .orderBy('student.lastName', 'ASC')
      .addOrderBy('student.firstName', 'ASC')
      .limit(20)
      .getMany();
  }

  async create(
    createStudentDto: CreateStudentDto,
    schoolId: string,
  ): Promise<Student> {
    if (!schoolId) throw new UnauthorizedException('Accès refusé.');

    const student = this.studentRepository.create({
      schoolId,
      firstName: createStudentDto.firstName.trim(),
      lastName: createStudentDto.lastName.trim(),
      birthDay: this.parseBirthDay(createStudentDto.birthDay),
      parentPhone: createStudentDto.parentPhone,
    });

    return await this.studentRepository.save(student);
  }

  /**
   * Correction d'une fiche élève : orthographe du nom, date de naissance,
   * numéro du parent.
   *
   * La fiche est partagée par toutes les inscriptions de l'élève : corriger un
   * nom mal saisi le corrige rétroactivement sur les bulletins et les reçus à
   * venir, ce qui est bien l'effet recherché — c'est le même enfant.
   *
   * L'établissement de rattachement n'est volontairement pas modifiable : un
   * enfant qui change d'école a une fiche par école, et déplacer la fiche
   * emporterait ses inscriptions, ses notes et ses absences hors du
   * cloisonnement de l'établissement d'origine.
   */
  async update(
    studentId: string,
    dto: UpdateStudentDto,
    schoolId: string,
  ): Promise<Student> {
    if (!schoolId) throw new UnauthorizedException('Accès refusé.');

    const student = await this.studentRepository.findOne({
      where: { id: studentId, schoolId },
    });
    if (!student) {
      throw new NotFoundException(`Élève introuvable (${studentId}).`);
    }

    const firstName = dto.firstName?.trim() ?? student.firstName;
    const lastName = dto.lastName?.trim() ?? student.lastName;
    const birthDay = dto.birthDay
      ? this.parseBirthDay(dto.birthDay)
      : student.birthDay;

    // Une correction ne doit pas aboutir à deux fiches pour le même enfant :
    // le triplet nom + prénom + date de naissance sert déjà à éviter le
    // doublon à la réinscription, il vaut aussi ici.
    const identityChanged =
      firstName !== student.firstName ||
      lastName !== student.lastName ||
      String(birthDay) !== String(student.birthDay);

    if (identityChanged) {
      const duplicate = await this.studentRepository
        .createQueryBuilder('student')
        .where('student.schoolId = :schoolId', { schoolId })
        .andWhere('student.id != :studentId', { studentId })
        .andWhere('LOWER(TRIM(student.firstName)) = :firstName', {
          firstName: firstName.toLowerCase(),
        })
        .andWhere('LOWER(TRIM(student.lastName)) = :lastName', {
          lastName: lastName.toLowerCase(),
        })
        .andWhere('student.birthDay = :birthDay', { birthDay })
        .getOne();

      if (duplicate) {
        throw new ConflictException(
          `Une autre fiche existe déjà pour ${lastName} ${firstName}, né(e) le même jour. Vérifiez qu'il ne s'agit pas du même élève.`,
        );
      }
    }

    student.firstName = firstName;
    student.lastName = lastName;
    student.birthDay = birthDay;
    if (dto.parentPhone) student.parentPhone = dto.parentPhone;

    return await this.studentRepository.save(student);
  }

  async findAllBySchool(
    schoolId: string,
    academicYearId?: string,
  ): Promise<Student[]> {
    if (typeof schoolId !== 'string' || schoolId.trim() === '') {
      throw new UnauthorizedException('Accès refusé.');
    }

    const resolvedYearId = await this.resolveAcademicYearId(
      schoolId,
      academicYearId,
    );

    return await this.studentRepository
      .createQueryBuilder('student')
      .innerJoin(
        'student.enrollments',
        'enrollment',
        'enrollment.schoolId = :schoolId AND enrollment.academicYearId = :resolvedYearId',
        { schoolId, resolvedYearId },
      )
      .orderBy('student.createdAt', 'DESC')
      .getMany();
  }

  async findOneBySchool(
    studentId: string,
    schoolId: string,
    academicYearId?: string,
  ) {
    if (
      typeof studentId !== 'string' ||
      studentId.trim() === '' ||
      typeof schoolId !== 'string' ||
      schoolId.trim() === ''
    ) {
      throw new UnauthorizedException('Accès refusé.');
    }

    const resolvedYearId = await this.resolveAcademicYearId(
      schoolId,
      academicYearId,
    );

    const student = await this.studentRepository
      .createQueryBuilder('student')
      .select([
        'student.id',
        'student.firstName',
        'student.lastName',
        'student.birthDay',
        'student.parentPhone',
      ])
      .addSelect([
        'enrollment.id',
        'enrollment.classRoomId',
        'enrollment.academicYearId',
        'enrollment.status',
        'enrollment.reference',
      ])
      .innerJoin(
        'student.enrollments',
        'enrollment',
        'enrollment.schoolId = :schoolId AND enrollment.academicYearId = :resolvedYearId',
        { schoolId, resolvedYearId },
      )
      .where('student.id = :studentId', { studentId })
      .getOne();

    if (!student) {
      throw new NotFoundException(
        `Élève introuvable avec l'identifiant ${studentId}`,
      );
    }
    return student;
  }
}
