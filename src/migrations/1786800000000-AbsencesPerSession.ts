import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * L'assiduité passe de la demi-journée à la séance de cours.
 *
 * Le relevé par demi-journée ne disait pas quel cours avait été manqué, et
 * n'importe quel enseignant intervenant dans la classe pouvait le faire.
 * Rattachée à un créneau de l'emploi du temps, une absence porte désormais sa
 * matière, son horaire et son professeur — et chacun ne fait l'appel que dans
 * ses propres cours.
 *
 * Les lignes existantes sont supprimées, non converties : une demi-journée ne
 * se répartit pas en séances sans inventer laquelle a été manquée, et une
 * répartition arbitraire produirait des cumuls faux au bulletin. La migration
 * refuse de s'exécuter si des absences subsistent, plutôt que de les détruire
 * en silence.
 */
export class AbsencesPerSession1786800000000 implements MigrationInterface {
  name = 'AbsencesPerSession1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "absences"`,
    );

    if (count > 0) {
      throw new Error(
        `Cette migration change le modèle d'assiduité et ne sait pas convertir ` +
          `les ${count} absence(s) par demi-journée déjà enregistrées. ` +
          `Exportez-les si elles ont de la valeur, puis videz la table ` +
          `(DELETE FROM "absences") avant de relancer.`,
      );
    }

    await queryRunner.query(`
      CREATE TYPE "absences_status_enum" AS ENUM ('ABSENT', 'LATE')
    `);

    /**
     * `DROP COLUMN` emporte la contrainte d'unicité qui portait sur
     * `halfDay` — son nom est auto-généré, l'expliciter serait fragile.
     */
    await queryRunner.query(`
      ALTER TABLE "absences"
        DROP COLUMN "halfDay",
        ADD COLUMN "status" "absences_status_enum" NOT NULL DEFAULT 'ABSENT',
        ADD COLUMN "scheduleEntryId" uuid,
        ADD COLUMN "subjectId" uuid NOT NULL,
        ADD COLUMN "timeSlotId" uuid NOT NULL
    `);

    /**
     * `SET NULL` sur la séance : réorganiser l'emploi du temps en cours
     * d'année ne doit pas effacer l'assiduité déjà constatée. Le constat
     * survit, seul le lien vers l'horaire disparaît — la matière et le
     * créneau restent, recopiés à la saisie.
     */
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD CONSTRAINT "FK_absences_schedule_entry"
        FOREIGN KEY ("scheduleEntryId") REFERENCES "schedule_entries"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD CONSTRAINT "FK_absences_subject"
        FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD CONSTRAINT "FK_absences_time_slot"
        FOREIGN KEY ("timeSlotId") REFERENCES "time_slots"("id") ON DELETE CASCADE
    `);

    // Un élève ne peut avoir qu'un statut par séance : deux cours ne pouvant
    // se superposer, la date et le créneau suffisent à l'identifier.
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD CONSTRAINT "UQ_absences_enrollment_date_slot"
        UNIQUE ("enrollmentId", "date", "timeSlotId")
    `);

    // Sert la vue « par matière » de la direction.
    await queryRunner.query(`
      CREATE INDEX "IDX_absences_school_subject"
        ON "absences" ("schoolId", "subjectId")
    `);

    // Le type de la demi-journée ne sert plus à aucune colonne.
    await queryRunner.query(`DROP TYPE IF EXISTS "absences_halfday_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_absences_school_subject"`);
    await queryRunner.query(`
      ALTER TABLE "absences"
        DROP CONSTRAINT IF EXISTS "UQ_absences_enrollment_date_slot",
        DROP CONSTRAINT IF EXISTS "FK_absences_time_slot",
        DROP CONSTRAINT IF EXISTS "FK_absences_subject",
        DROP CONSTRAINT IF EXISTS "FK_absences_schedule_entry",
        DROP COLUMN "timeSlotId",
        DROP COLUMN "subjectId",
        DROP COLUMN "scheduleEntryId",
        DROP COLUMN "status"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "absences_status_enum"`);

    await queryRunner.query(`
      CREATE TYPE "absences_halfday_enum" AS ENUM ('MORNING', 'AFTERNOON')
    `);
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD COLUMN "halfDay" "absences_halfday_enum" NOT NULL DEFAULT 'MORNING'
    `);
  }
}
