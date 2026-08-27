import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comptes parents et liens de tutelle.
 *
 * Deux changements indissociables :
 *
 *  - `users` gagne une identité civile (nom, prénom, téléphone). Nullable :
 *    les comptes du personnel existants ont été créés sans, et l'email suffit
 *    à les désigner. Un parent, lui, se présente au guichet en donnant un nom.
 *
 *  - `parent_students` porte le lien de tutelle. C'est la seule autorisation
 *    d'accès d'un parent : contrairement au personnel, dont le `schoolId` du
 *    jeton ouvre tout l'établissement, un parent ne voit que les élèves
 *    nommés dans cette table.
 *
 * Le rôle PARENT lui-même n'exige aucune migration : `users.roles` est un
 * `text[]`, non un type énuméré PostgreSQL.
 */
export class AddParentAccounts1786600000000 implements MigrationInterface {
  name = 'AddParentAccounts1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "firstName" character varying(50),
        ADD COLUMN "lastName" character varying(50),
        ADD COLUMN "phone" character varying(20)
    `);

    await queryRunner.query(`
      CREATE TABLE "parent_students" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "parentId" uuid NOT NULL,
        "studentId" uuid NOT NULL,
        "schoolId" uuid NOT NULL,
        "relationship" character varying(30),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_parent_students" PRIMARY KEY ("id")
      )
    `);

    /**
     * `CASCADE` sur les trois clés : un lien de tutelle n'a aucun sens sans
     * l'un de ses trois bouts. Supprimer une fiche élève, un compte parent ou
     * un établissement doit emporter le lien, et non laisser une ligne
     * orpheline qui autoriserait un accès vers le vide.
     */
    await queryRunner.query(`
      ALTER TABLE "parent_students"
        ADD CONSTRAINT "FK_parent_students_parent"
        FOREIGN KEY ("parentId") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "parent_students"
        ADD CONSTRAINT "FK_parent_students_student"
        FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "parent_students"
        ADD CONSTRAINT "FK_parent_students_school"
        FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE
    `);

    // Un double clic du secrétariat ne doit pas afficher l'enfant deux fois
    // dans l'espace du parent.
    await queryRunner.query(`
      ALTER TABLE "parent_students"
        ADD CONSTRAINT "UQ_parent_students_parent_student"
        UNIQUE ("parentId", "studentId")
    `);

    // Requête de loin la plus fréquente : « les enfants de ce parent ».
    await queryRunner.query(`
      CREATE INDEX "IDX_parent_students_parent"
        ON "parent_students" ("parentId")
    `);
    // Sert le sens inverse, qu'emprunte le secrétariat depuis la fiche élève.
    await queryRunner.query(`
      CREATE INDEX "IDX_parent_students_school_student"
        ON "parent_students" ("schoolId", "studentId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "parent_students"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "phone",
        DROP COLUMN "lastName",
        DROP COLUMN "firstName"
    `);
  }
}
