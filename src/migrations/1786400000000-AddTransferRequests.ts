import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Demandes de transfert de dossier entre établissements.
 *
 * Contrairement à `action` du journal d'audit, `status` est bien un type
 * énuméré PostgreSQL : ses quatre valeurs décrivent un cycle de vie fermé
 * dont dépend le contrôle d'accès aux bulletins. Une valeur inattendue en
 * base ouvrirait ou fermerait un accès à tort ; la contrainte a ici quelque
 * chose à faire respecter.
 */
export class AddTransferRequests1786400000000 implements MigrationInterface {
  name = 'AddTransferRequests1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "transfer_requests_status_enum" AS ENUM (
        'PENDING', 'APPROVED', 'REJECTED', 'REVOKED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "transfer_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "requestingSchoolId" uuid NOT NULL,
        "holdingSchoolId" uuid NOT NULL,
        "studentId" uuid NOT NULL,
        "status" "transfer_requests_status_enum" NOT NULL DEFAULT 'PENDING',
        "reason" character varying(500) NOT NULL,
        "decisionReason" character varying(500),
        "requestedById" uuid NOT NULL,
        "decidedById" uuid,
        "decidedAt" TIMESTAMP,
        "expiresAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transfer_requests" PRIMARY KEY ("id")
      )
    `);

    // Écoles et fiche : la suppression d'un établissement ou d'une fiche prive
    // la demande de son objet, elle disparaît avec.
    await queryRunner.query(`
      ALTER TABLE "transfer_requests"
      ADD CONSTRAINT "FK_transfer_requests_requesting_school"
      FOREIGN KEY ("requestingSchoolId") REFERENCES "schools"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "transfer_requests"
      ADD CONSTRAINT "FK_transfer_requests_holding_school"
      FOREIGN KEY ("holdingSchoolId") REFERENCES "schools"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "transfer_requests"
      ADD CONSTRAINT "FK_transfer_requests_student"
      FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE
    `);

    // Auteurs de la demande et de la décision : NO ACTION, pour que la trace
    // de qui a accordé un accès survive au départ de l'agent.
    await queryRunner.query(`
      ALTER TABLE "transfer_requests"
      ADD CONSTRAINT "FK_transfer_requests_requested_by"
      FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "transfer_requests"
      ADD CONSTRAINT "FK_transfer_requests_decided_by"
      FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_transfer_requests_requesting"
      ON "transfer_requests" ("requestingSchoolId", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_transfer_requests_holding"
      ON "transfer_requests" ("holdingSchoolId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "transfer_requests"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "transfer_requests_status_enum"`);
  }
}
