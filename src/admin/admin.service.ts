import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Not, Repository } from "typeorm";
import { CreateSchoolDto, CreateStudentDto, CreateUserDto } from "../dto/index";
import { Student, School, User } from "../entities/index";
import * as bcrypt from 'bcrypt';
import { Role } from "src/common/enums/role.enum";
import { generateTemporaryPassword } from "../common/utils/generate-password";
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(School)
    private readonly schoolRepository: Repository<School>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly auditService: AuditService,
  ) { }

  async onModuleInit() {
    await this.seedSuperAdmin();
    await this.flagLegacySuperAdminPassword();
  }

  /**
   * Crée le compte super-administrateur au premier démarrage, s'il n'en existe
   * aucun.
   *
   * Le mot de passe provient de SUPER_ADMIN_PASSWORD. À défaut :
   *  - hors production, un mot de passe aléatoire est généré et affiché une
   *    seule fois, à la création — jamais aux démarrages suivants ;
   *  - en production, aucun compte n'est créé : mieux vaut une plateforme sans
   *    super-admin qu'un super-admin dont le mot de passe est dans le dépôt.
   *
   * Dans tous les cas où le mot de passe n'a pas été choisi par vous, le compte
   * est marqué « à changer à la première connexion ».
   */
  private async seedSuperAdmin() {
    const existingCount = await this.usersRepository
      .createQueryBuilder('user')
      .where(':role = ANY(user.roles)', { role: Role.SUPER_ADMIN })
      .getCount();

    if (existingCount > 0) return;

    const email = process.env.SUPER_ADMIN_EMAIL || 'superadmin@gestashool.com';
    const providedPassword = process.env.SUPER_ADMIN_PASSWORD;
    const isProduction = process.env.NODE_ENV === 'production';

    if (!providedPassword && isProduction) {
      this.logger.error(
        "Aucun super-administrateur n'existe et SUPER_ADMIN_PASSWORD n'est pas défini. " +
          'Aucun compte ne sera créé : renseignez SUPER_ADMIN_EMAIL et SUPER_ADMIN_PASSWORD, puis redémarrez.',
      );
      return;
    }

    const password = providedPassword || generateTemporaryPassword(16);
    const passwordHash = await bcrypt.hash(password, 12);

    const superAdmin = this.usersRepository.create({
      email,
      passwordHash,
      roles: [Role.SUPER_ADMIN],
      // Un mot de passe que vous n'avez pas choisi doit être remplacé
      mustChangePassword: !providedPassword,
    });
    await this.usersRepository.save(superAdmin);

    if (providedPassword) {
      this.logger.log(`Super-administrateur créé : ${email}`);
    } else {
      // Affiché uniquement à la création, jamais aux démarrages suivants
      this.logger.warn(
        `Super-administrateur créé : ${email}\n` +
          `  Mot de passe provisoire : ${password}\n` +
          '  Notez-le : il ne sera plus affiché, et devra être changé à la première connexion.',
      );
    }
  }

  /**
   * Remédiation du mot de passe par défaut historique.
   *
   * Les installations antérieures créaient le super-administrateur avec un mot
   * de passe en dur, présent dans le dépôt. Plutôt que de le remplacer par un
   * mot de passe que nous choisirions, le compte concerné est marqué comme
   * provisoire : la connexion reste possible, mais la première action imposée
   * sera d'en définir un nouveau.
   */
  private async flagLegacySuperAdminPassword() {
    const LEGACY_PASSWORD = 'admin123';

    const admins = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where(':role = ANY(user.roles)', { role: Role.SUPER_ADMIN })
      .andWhere('user.mustChangePassword = false')
      .getMany();

    for (const admin of admins) {
      if (await bcrypt.compare(LEGACY_PASSWORD, admin.passwordHash)) {
        admin.mustChangePassword = true;
        await this.usersRepository.save(admin);
        this.logger.warn(
          `Le compte ${admin.email} utilise encore le mot de passe par défaut. ` +
            'Un changement lui sera imposé à la prochaine connexion.',
        );
      }
    }
  }


  //   ----- STUDENTS -----
  async createStudent(
    createStudentDto: CreateStudentDto,
    schoolId: string,
  ): Promise<Student> {
    const school = await this.schoolRepository.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException(
        `Un établissement avec l'identifiant ${schoolId} n'a pas été trouvé.`,
      );
    }

    // La date arrive au format local JJ-MM-AAAA et doit être convertie
    const [day, month, year] = createStudentDto.birthDay.split(/[-/]/);

    const student = this.studentRepository.create({
      schoolId,
      firstName: createStudentDto.firstName.trim(),
      lastName: createStudentDto.lastName.trim(),
      birthDay: new Date(Number(year), Number(month) - 1, Number(day)),
      parentPhone: createStudentDto.parentPhone,
    });
    return await this.studentRepository.save(student);
  }

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






  // ----- SCHOOLS -----

  async findAllSchool(): Promise<School[]> {
    return await this.schoolRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOneSchool(id: string): Promise<School> {
    const school = await this.schoolRepository.findOne({ where: { id } });
    if (!school) {
      throw new NotFoundException(`Établissement introuvable avec l'identifiant ${id}`);
    }
    return school;
  }

  async createSchool(
    createSchoolDto: CreateSchoolDto,
    actor?: AuthUser,
  ): Promise<School> {
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

    const saved = await this.schoolRepository.save(school);

    /**
     * `schoolId` pointe sur l'établissement créé : la ligne appartient à son
     * propre journal, et le directeur qui prendra la main la verra.
     */
    void this.auditService.record(
      {
        action: AuditAction.SCHOOL_CREATED,
        entityType: 'schools',
        entityId: saved.id,
        schoolId: saved.id,
        summary: `Établissement ${saved.name} (${saved.slug}) créé`,
      },
      actor,
    );

    return saved;
  }


  // ----- USERS (staff) -----

  /**
   * Création d'un compte par l'administrateur de la plateforme.
   *
   * Deux cas distincts :
   *  - compte d'établissement (directeur, secrétaire, comptable, enseignant) :
   *    l'école cible est obligatoire ;
   *  - compte d'administration de la plateforme : il n'est rattaché à AUCUNE
   *    école. Un SUPER_ADMIN porteur d'un schoolId serait trompeur, puisque
   *    son pouvoir s'étend de toute façon à tous les établissements.
   *
   * Cette route est réservée au SUPER_ADMIN par le contrôleur : c'est le seul
   * endroit où le rôle d'administration peut être attribué.
   */
  async createUser(createUserDto: CreateUserDto): Promise<User> {
    if (createUserDto.roles.length === 0) {
      throw new BadRequestException('Au moins un rôle est obligatoire.');
    }

    const isPlatformAdmin = createUserDto.roles.includes(Role.SUPER_ADMIN);

    if (isPlatformAdmin && createUserDto.roles.length > 1) {
      throw new BadRequestException(
        "Le rôle d'administrateur de la plateforme ne se combine avec aucun rôle d'établissement.",
      );
    }

    const existing = await this.usersRepository.findOne({ where: { email: createUserDto.email } });
    if (existing) {
      throw new ConflictException('Un utilisateur avec cet email existe déjà.');
    }

    const passwordHash = await bcrypt.hash(createUserDto.password, 12);

    if (isPlatformAdmin) {
      // slug et schoolId sont volontairement omis : le compte n'appartient à
      // aucun établissement.
      const admin = this.usersRepository.create({
        email: createUserDto.email,
        passwordHash,
        roles: [Role.SUPER_ADMIN],
      });
      return await this.usersRepository.save(admin);
    }

    if (!createUserDto.schoolId) {
      throw new NotFoundException("L'admin doit spécifier l'école cible (schoolId) lors de la création d'un utilisateur.");
    }

    const school = await this.schoolRepository.findOne({ where: { id: createUserDto.schoolId } });
    if (!school) {
      throw new NotFoundException(`Un établissement avec l'identifiant ${createUserDto.schoolId} n'a pas été trouvé.`);
    }

    const user = this.usersRepository.create({
      email: createUserDto.email,
      passwordHash,
      roles: createUserDto.roles,
      // slug et schoolId résolus depuis l'école cible
      slug: school.slug,
      schoolId: school.id,
    });

    return await this.usersRepository.save(user);
  }

  /**
   * Liste tous les utilisateurs staff (exclut les SUPER_ADMIN)
   */
  async findAllUsers(): Promise<User[]> {
    return await this.usersRepository.find({
      where: { roles: Not([Role.SUPER_ADMIN]) as any },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Liste tous les directeurs
   */
  async findAllDirectors(): Promise<User[]> {
    return await this.usersRepository
      .createQueryBuilder('user')
      .where(':role = ANY(user.roles)', { role: Role.DIRECTOR })
      .orderBy('user.createdAt', 'DESC')
      .getMany();
  }

}