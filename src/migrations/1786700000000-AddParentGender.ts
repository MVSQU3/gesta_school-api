import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Le sexe du parent remplace le lien de parenté saisi à la main.
 *
 * Le lien était porté par chaque rattachement, en texte libre : la même
 * personne pouvait être « Père » pour un enfant et « pere » pour le suivant,
 * et rien ne garantissait que la valeur soit renseignée. Le sexe est porté par
 * le compte, dans un ensemble fermé : une personne ne change pas d'un enfant à
 * l'autre, et l'écran sait toujours dire « Père » ou « Mère ».
 *
 * `varchar` plutôt qu'un type énuméré PostgreSQL : la colonne est descriptive
 * et ne commande aucune règle d'accès. Une contrainte de type ici n'aurait
 * rien à faire respecter, et rendrait plus lourd l'ajout d'une valeur.
 */
export class AddParentGender1786700000000 implements MigrationInterface {
  name = 'AddParentGender1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "gender" character varying(10)
    `);

    /**
     * Reprise des liens déjà saisis, quand ils sont sans ambiguïté.
     *
     * Un parent rattaché à plusieurs enfants a autant de lignes ; `DISTINCT`
     * puis le filtre sur un seul lien distinct écartent les cas où la saisie
     * diverge d'un enfant à l'autre. Mieux vaut laisser ces comptes sans sexe,
     * que le secrétariat corrigera, que de trancher à leur place.
     */
    await queryRunner.query(`
      UPDATE "users" u
      SET "gender" = CASE
        WHEN lower(trim(l.rel)) IN ('père', 'pere', 'papa') THEN 'MALE'
        WHEN lower(trim(l.rel)) IN ('mère', 'mere', 'maman') THEN 'FEMALE'
      END
      FROM (
        SELECT "parentId", min("relationship") AS rel
        FROM "parent_students"
        WHERE "relationship" IS NOT NULL AND trim("relationship") <> ''
        GROUP BY "parentId"
        HAVING count(DISTINCT lower(trim("relationship"))) = 1
      ) l
      WHERE u."id" = l."parentId"
    `);

    await queryRunner.query(`
      ALTER TABLE "parent_students" DROP COLUMN "relationship"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "parent_students"
        ADD COLUMN "relationship" character varying(30)
    `);

    // Restitution du lien à partir du sexe, pour les comptes qui en ont un.
    await queryRunner.query(`
      UPDATE "parent_students" ps
      SET "relationship" = CASE u."gender"
        WHEN 'MALE' THEN 'Père'
        WHEN 'FEMALE' THEN 'Mère'
      END
      FROM "users" u
      WHERE ps."parentId" = u."id" AND u."gender" IS NOT NULL
    `);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "gender"`);
  }
}
