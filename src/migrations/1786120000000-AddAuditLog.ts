import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Journal d'audit des opérations administratives.
 *
 * `action` et `entityType` sont de simples `varchar` et non des types énumérés
 * PostgreSQL : la liste des opérations tracées va s'étoffer au fil des
 * fonctionnalités, et chaque ajout imposerait sinon une migration `ALTER TYPE`
 * pour une valeur qui n'a aucune contrainte d'intégrité à faire respecter.
 */
export class AddAuditLog1786120000000 implements MigrationInterface {
  name = 'AddAuditLog1786120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "schoolId" uuid,
        "actorUserId" uuid,
        "actorEmail" character varying(255),
        "action" character varying(60) NOT NULL,
        "entityType" character varying(40) NOT NULL,
        "entityId" uuid,
        "summary" character varying(255) NOT NULL,
        "changes" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);

    // Supprimer une école emporte son journal ; supprimer un compte laisse ses
    // lignes en place, l'adresse de l'auteur étant recopiée sur chacune.
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD CONSTRAINT "FK_audit_logs_school"
        FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD CONSTRAINT "FK_audit_logs_actor"
        FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Consultation courante : le journal d'un établissement, du plus récent au
    // plus ancien.
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_school_date" ON "audit_logs" ("schoolId", "createdAt")`,
    );
    // Historique d'un objet précis, affiché à côté de sa fiche.
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_entity" ON "audit_logs" ("entityType", "entityId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_entity"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_logs_school_date"`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_logs_actor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_logs_school"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
