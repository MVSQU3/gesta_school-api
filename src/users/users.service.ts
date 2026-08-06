import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../common/enums/role.enum';
import { generateTemporaryPassword } from '../common/utils/generate-password';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { School } from 'src/entities';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(School)
    private schoolRepository: Repository<School>,
    private readonly auditService: AuditService,
  ) { }

  /**
   * Création d'un compte du personnel d'un établissement.
   *
   * Les rôles sont filtrés ici, et pas seulement à l'écran : cet endpoint est
   * ouvert aux directeurs, or le rôle SUPER_ADMIN donne accès à TOUS les
   * établissements. Sans ce contrôle, un directeur pouvait se fabriquer un
   * compte d'administration de la plateforme et prendre la main sur les
   * écoles voisines. La modification d'un compte le refusait déjà — la
   * création ne le refusait pas.
   */
  async createStaff(
    createUserDto: CreateUserDto,
    schoolId: string,
    actor?: AuthUser,
  ): Promise<User> {
    if (createUserDto.roles.includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException(
        "Le rôle d'administrateur de la plateforme ne peut pas être attribué à un compte d'établissement.",
      );
    }

    if (createUserDto.roles.length === 0) {
      throw new BadRequestException('Au moins un rôle est obligatoire.');
    }

    const school = await this.schoolRepository.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException(`Un établissement avec l'identifiant ${schoolId} n'a pas été trouvé.`)
    }

    const existingUser = await this.usersRepository.findOne({
      where: { email: createUserDto.email },
    });
    if (existingUser) {
      throw new ConflictException("Un utilisateur avec ce email existe déjà.")
    }

    const passwordHash = await bcrypt.hash(createUserDto.password, 12);
    const user = this.usersRepository.create({
      email: createUserDto.email,
      passwordHash,
      roles: createUserDto.roles,
      // schoolId et slug proviennent de l'école résolue (JWT du directeur ou schoolId admin)
      slug: school.slug,
      schoolId: school.id,
    });

    const saved = await this.usersRepository.save(user);

    void this.auditService.record(
      {
        action: AuditAction.USER_CREATED,
        entityType: 'users',
        entityId: saved.id,
        schoolId,
        summary: `Compte ${saved.email} cree (${saved.roles.join(', ')})`,
      },
      actor,
    );

    return saved;
  }

  /**
   * Recherche par email pour l'authentification.
   * `addSelect` est nécessaire : la colonne passwordHash est en `select: false`
   * pour ne jamais fuiter dans les réponses d'API.
   */
  async findByEmail(email: string): Promise<User | null> {
    return await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Horodatage de révocation, tronqué à la seconde.
   *
   * Le champ `iat` d'un JWT est exprimé en secondes : conserver les
   * millisecondes ferait tomber le jeton émis dans la même seconde du côté
   * « antérieur au changement », et le jeton de remplacement serait rejeté
   * dès son émission.
   */
  private revocationTimestamp(): Date {
    return new Date(Math.floor(Date.now() / 1000) * 1000);
  }

  /**
   * Chargement du compte pour la validation d'un jeton.
   * Le hash n'est pas remonté : seul l'état du compte est nécessaire.
   */
  async findByIdForAuth(id: string): Promise<User | null> {
    return await this.usersRepository.findOne({ where: { id } });
  }

  /**
   * Changement de mot de passe par l'utilisateur lui-même.
   * Le mot de passe actuel est exigé : sans lui, une session laissée ouverte
   * sur un poste partagé suffirait à confisquer le compte.
   */
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<User> {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException('Compte introuvable.');
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect.');
    }

    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException(
        "Le nouveau mot de passe doit être différent de l'actuel.",
      );
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordChangedAt = this.revocationTimestamp();
    // L'utilisateur a choisi son mot de passe : la contrainte est levée
    user.mustChangePassword = false;
    return await this.usersRepository.save(user);
  }

  /**
   * Réinitialisation par la direction, pour un employé ayant perdu son mot
   * de passe. Les mêmes garde-fous que les autres opérations sur le personnel
   * s'appliquent : même école, et jamais un compte d'administration.
   *
   * Le directeur ne peut pas réinitialiser le sien par ce biais : cela
   * contournerait la vérification du mot de passe actuel.
   */
  async resetPassword(
    id: string,
    newPassword: string | undefined,
    schoolId: string,
    requesterId: string,
    actor?: AuthUser,
  ): Promise<{ message: string; email: string; temporaryPassword: string }> {
    const user = await this.findStaffOfSchool(id, schoolId);

    if (user.id === requesterId) {
      throw new BadRequestException(
        'Utilisez le changement de mot de passe pour votre propre compte.',
      );
    }

    // Sans mot de passe fourni, on en génère un : c'est le cas courant, et il
    // évite au directeur d'improviser un mot de passe faible.
    const password = newPassword?.trim() || generateTemporaryPassword();

    user.passwordHash = await bcrypt.hash(password, 12);
    user.passwordChangedAt = this.revocationTimestamp();
    // Provisoire : l'intéressé devra le remplacer dès sa prochaine connexion
    user.mustChangePassword = true;
    await this.usersRepository.save(user);

    // Le mot de passe provisoire lui-même n'est evidemment pas journalise :
    // le journal est consultable, il ne doit pas devenir un annuaire de
    // secrets. Seul le fait qu'une reinitialisation a eu lieu est trace.
    void this.auditService.record(
      {
        action: AuditAction.USER_PASSWORD_RESET,
        entityType: 'users',
        entityId: user.id,
        schoolId,
        summary: `Mot de passe de ${user.email} reinitialise ; ses sessions ouvertes ont ete fermees`,
      },
      actor,
    );

    return {
      message: `Mot de passe de ${user.email} réinitialisé. Ses sessions ouvertes ont été fermées ; il devra choisir un nouveau mot de passe à sa prochaine connexion.`,
      email: user.email,
      temporaryPassword: password,
    };
  }

  /**
   * Personnel d'un établissement. Les SUPER_ADMIN, qui ne sont rattachés à
   * aucune école, n'y figurent jamais.
   */
  async findAllBySchool(schoolId: string): Promise<User[]> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');
    return await this.usersRepository.find({
      where: { schoolId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Charge un employé en vérifiant qu'il appartient bien à l'école du demandeur
   * et qu'il n'est pas SUPER_ADMIN — un directeur ne touche pas à un compte
   * d'administration de la plateforme.
   */
  private async findStaffOfSchool(id: string, schoolId: string): Promise<User> {
    if (!schoolId) throw new ForbiddenException('schoolId est requis');

    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Aucun employé trouvé avec l'identifiant ${id}`);
    }
    if (user.schoolId !== schoolId) {
      throw new ForbiddenException(
        "Cet employé n'appartient pas à votre établissement.",
      );
    }
    if (user.roles.includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException(
        "Un compte d'administration de la plateforme ne peut pas être modifié ici.",
      );
    }
    return user;
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    schoolId: string,
    requesterId: string,
    actor?: AuthUser,
  ): Promise<User> {
    const user = await this.findStaffOfSchool(id, schoolId);

    // Capture AVANT toute mutation : plus bas, `user.email` est écrasé sur
    // place, et relire l'état à ce moment-là ne montrerait plus aucun écart.
    const before = { email: user.email, roles: [...user.roles] };

    if (updateUserDto.roles?.includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException(
        "Le rôle d'administrateur de la plateforme ne peut pas être attribué depuis l'espace direction.",
      );
    }

    // Empêche un directeur de se retirer lui-même son propre rôle et de perdre
    // l'accès à l'espace de gestion.
    if (
      user.id === requesterId &&
      updateUserDto.roles &&
      !updateUserDto.roles.includes(Role.DIRECTOR)
    ) {
      throw new BadRequestException(
        'Vous ne pouvez pas retirer votre propre rôle de directeur.',
      );
    }

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existing = await this.usersRepository.findOne({
        where: { email: updateUserDto.email },
      });
      if (existing) {
        throw new ConflictException('Un utilisateur avec cet email existe déjà.');
      }
      user.email = updateUserDto.email;
    }

    if (updateUserDto.roles) {
      user.roles = updateUserDto.roles;
    }

    const saved = await this.usersRepository.save(user);
    const changes = this.auditService.diff(before, {
      email: saved.email,
      roles: saved.roles,
    });

    if (changes) {
      void this.auditService.record(
        {
          action: AuditAction.USER_UPDATED,
          entityType: 'users',
          entityId: saved.id,
          schoolId,
          summary: changes.roles
            ? `Roles de ${saved.email} : ${before.roles.join(', ')} -> ${saved.roles.join(', ')}`
            : `Compte ${before.email} renomme en ${saved.email}`,
          changes,
        },
        actor,
      );
    }

    return saved;
  }

  /**
   * Active ou désactive un compte. La désactivation coupe la connexion tout en
   * conservant l'historique des opérations réalisées par cet employé.
   */
  async setActive(
    id: string,
    isActive: boolean,
    schoolId: string,
    requesterId: string,
    actor?: AuthUser,
  ): Promise<User> {
    const user = await this.findStaffOfSchool(id, schoolId);

    if (user.id === requesterId && !isActive) {
      throw new BadRequestException(
        'Vous ne pouvez pas désactiver votre propre compte.',
      );
    }

    // Une école doit toujours conserver au moins un directeur actif.
    if (!isActive && user.roles.includes(Role.DIRECTOR)) {
      const activeDirectors = await this.usersRepository
        .createQueryBuilder('user')
        .where('user.schoolId = :schoolId', { schoolId })
        .andWhere('user.isActive = true')
        .andWhere('user.id != :id', { id })
        .andWhere(':role = ANY(user.roles)', { role: Role.DIRECTOR })
        .getCount();

      if (activeDirectors === 0) {
        throw new BadRequestException(
          "Impossible de désactiver le dernier directeur actif de l'établissement.",
        );
      }
    }

    user.isActive = isActive;
    const saved = await this.usersRepository.save(user);

    void this.auditService.record(
      {
        action: AuditAction.USER_STATUS_CHANGED,
        entityType: 'users',
        entityId: saved.id,
        schoolId,
        summary: `Compte ${saved.email} ${isActive ? 'reactive' : 'desactive'}`,
        changes: { isActive: { before: !isActive, after: isActive } },
      },
      actor,
    );

    return saved;
  }

  /**
   * Suppression définitive d'un compte.
   *
   * L'historique est préservé : les inscriptions saisies et les encaissements
   * réalisés restent en base, leur lien vers l'utilisateur passant simplement
   * à NULL (ON DELETE SET NULL). La désactivation reste préférable lorsqu'on
   * souhaite garder l'attribution nominative.
   */
  async remove(
    id: string,
    schoolId: string,
    requesterId: string,
    actor?: AuthUser,
  ): Promise<{ message: string }> {
    const user = await this.findStaffOfSchool(id, schoolId);

    if (user.id === requesterId) {
      throw new BadRequestException(
        'Vous ne pouvez pas supprimer votre propre compte.',
      );
    }

    if (user.roles.includes(Role.DIRECTOR)) {
      const otherDirectors = await this.usersRepository
        .createQueryBuilder('user')
        .where('user.schoolId = :schoolId', { schoolId })
        .andWhere('user.id != :id', { id })
        .andWhere(':role = ANY(user.roles)', { role: Role.DIRECTOR })
        .getCount();

      if (otherDirectors === 0) {
        throw new BadRequestException(
          "Impossible de supprimer le dernier directeur de l'établissement.",
        );
      }
    }

    const removedEmail = user.email;
    const removedRoles = [...user.roles];
    await this.usersRepository.remove(user);

    void this.auditService.record(
      {
        action: AuditAction.USER_DELETED,
        entityType: 'users',
        entityId: id,
        schoolId,
        summary: `Compte ${removedEmail} supprime (${removedRoles.join(', ')})`,
      },
      actor,
    );

    return { message: `Le compte ${removedEmail} a été supprimé.` };
  }
}
