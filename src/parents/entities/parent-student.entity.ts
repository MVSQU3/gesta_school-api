import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { Student } from '../../students/entities/student.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Lien de tutelle entre un compte parent et une fiche élève.
 *
 * Table de liaison plutôt que colonne `parentId` sur `Student` : un enfant est
 * couramment suivi par deux comptes — père et mère séparés, ou un tuteur en
 * plus d'un parent — et l'inverse est tout aussi courant, un parent ayant
 * plusieurs enfants dans l'établissement. Aucune des deux directions n'est
 * bornée à un.
 *
 * C'est aussi la seule autorisation d'accès du parent : contrairement au
 * personnel, dont le `schoolId` du jeton suffit à ouvrir tout l'établissement,
 * un parent ne voit que les élèves nommés ici.
 */
@Entity('parent_students')
// Un même rattachement ne doit pas pouvoir être créé deux fois : sans cette
// contrainte, un double clic du secrétariat afficherait l'enfant en double
// dans l'espace du parent.
@Unique('UQ_parent_students_parent_student', ['parentId', 'studentId'])
// Sert la requête de loin la plus fréquente : « les enfants de ce parent ».
@Index(['parentId'])
export class ParentStudent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  parentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parentId' })
  parent: User;

  @Column({ type: 'uuid' })
  studentId: string;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'studentId' })
  student: Student;

  /**
   * Établissement du rattachement, recopié depuis la fiche élève.
   *
   * Redondant avec `student.schoolId`, et c'est délibéré : toute vérification
   * de cloisonnement peut alors se faire sur cette seule table, sans jointure.
   * Une jointure oubliée est une fuite ; une colonne présente ne s'oublie pas.
   */
  @Column({ type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schoolId' })
  school: School;

  @CreateDateColumn()
  createdAt: Date;
}
