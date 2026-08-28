import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trace des appels effectués.
 *
 * « Présent » n'est pas enregistré — c'est l'absence de ligne dans
 * `absences`. Une séance où tous les élèves sont là ne laissait donc aucune
 * trace, et la base se retrouvait dans le même état que si l'appel n'avait
 * jamais été fait. Cette table enregistre le seul fait qui manquait, pour que
 * la direction puisse lister les appels **non faits**.
 *
 * Elle ne stocke pas les présents un par un : ce serait trente lignes par
 * heure de cours et par classe pour une information qui se déduit.
 */
export class AddRollCalls1786900000000 implements MigrationInterface {
  name = 'AddRollCalls1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roll_calls" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "schoolId" uuid NOT NULL,
        "scheduleEntryId" uuid NOT NULL,
        "date" date NOT NULL,
        "takenByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roll_calls" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "roll_calls"
        ADD CONSTRAINT "FK_roll_calls_school"
        FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE
    `);

    /**
     * `CASCADE` sur la séance, contrairement aux absences qui survivent en
     * `SET NULL` : « l'appel a été fait sur ce créneau » ne veut plus rien
     * dire quand le créneau a disparu de la grille, alors qu'une absence
     * reste un fait constaté sur un élève.
     */
    await queryRunner.query(`
      ALTER TABLE "roll_calls"
        ADD CONSTRAINT "FK_roll_calls_schedule_entry"
        FOREIGN KEY ("scheduleEntryId") REFERENCES "schedule_entries"("id")
        ON DELETE CASCADE
    `);

    // L'auteur survit à la suppression de son compte : la trace doit rester
    // même si l'enseignant quitte l'établissement.
    await queryRunner.query(`
      ALTER TABLE "roll_calls"
        ADD CONSTRAINT "FK_roll_calls_taken_by"
        FOREIGN KEY ("takenByUserId") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // Un appel par séance et par date : le refaire met à jour, il n'en crée
    // pas un second.
    await queryRunner.query(`
      ALTER TABLE "roll_calls"
        ADD CONSTRAINT "UQ_roll_calls_session_date"
        UNIQUE ("scheduleEntryId", "date")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_roll_calls_school_date"
        ON "roll_calls" ("schoolId", "date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "roll_calls"`);
  }
}
