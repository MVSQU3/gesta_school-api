import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Gender } from '../../common/enums/gender.enum';
import { Role } from '../../common/enums/role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  /**
   * `select: false` : le hash n'est jamais chargé par défaut, et ne peut donc
   * pas fuiter dans une réponse d'API. Seule l'authentification le récupère
   * explicitement (voir UsersService.findByEmail).
   */
  @Column({ select: false })
  passwordHash: string;

  /**
   * Identite civile. Nullable, et le restera : les comptes du personnel
   * existants ont ete crees sans, et l'email suffit a les designer.
   *
   * Pour un parent en revanche, c'est le nom qui sert a le retrouver au
   * guichet — une famille se presente en donnant un nom, jamais une adresse
   * email.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  /**
   * Sexe declare. Renseigne pour les comptes parents, ou il distingue le pere
   * de la mere ; nul pour le personnel, que rien n'oblige a le declarer.
   */
  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: Gender | null;

  @Column('text', { array: true, default: [] })
  roles: Role[];

  /**
   * Compte actif. Un employé qui quitte l'établissement est désactivé plutôt
   * que supprimé : la connexion lui est refusée, mais son nom reste attaché
   * aux inscriptions saisies et aux encaissements réalisés.
   */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Date du dernier changement de mot de passe.
   *
   * Tout jeton émis avant cette date est refusé : changer son mot de passe —
   * ou se le faire réinitialiser — coupe immédiatement les sessions ouvertes
   * ailleurs, au lieu d'attendre l'expiration naturelle du jeton.
   * `null` tant que le mot de passe initial n'a jamais été changé.
   */
  @Column({ type: 'timestamp', nullable: true })
  passwordChangedAt: Date | null;

  /**
   * Mot de passe provisoire en cours : l'utilisateur doit le remplacer avant
   * de pouvoir faire quoi que ce soit d'autre.
   *
   * Positionné lors d'une réinitialisation par la direction, levé dès que
   * l'intéressé a choisi son propre mot de passe. Sans cette contrainte, un
   * mot de passe provisoire — transmis oralement ou par message — resterait
   * en circulation indéfiniment.
   */
  @Column({ type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  slug: string;

  @Column({ nullable: true })
  schoolId: string | null;

  @ManyToOne(() => School, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
