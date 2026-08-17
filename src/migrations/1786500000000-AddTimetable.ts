import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emploi du temps hebdomadaire : grille horaire de l'établissement et séances.
 *
 * Les deux contraintes d'unicité sur `schedule_entries` sont le cœur du
 * dispositif : elles rendent impossible qu'une classe ait deux cours au même
 * moment, ou qu'un enseignant soit à deux endroits à la fois. Les poser en
 * base plutôt que dans le service ferme aussi le cas de deux requêtes
 * concurrentes, qu'un contrôle applicatif laisserait passer.
 */
export class AddTimetable1786500000000 implements MigrationInterface {
  name = 'AddTimetable1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "time_slots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "schoolId" uuid NOT NULL,
        "label" character varying(40) NOT NULL,
        "startTime" TIME NOT NULL,
        "endTime" TIME NOT NULL,
        "sequence" integer NOT NULL,
        "isBreak" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_time_slots" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_time_slots_school_sequence" UNIQUE ("schoolId", "sequence")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "time_slots"
      ADD CONSTRAINT "FK_time_slots_school"
      FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE TABLE "schedule_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "schoolId" uuid NOT NULL,
        "academicYearId" uuid NOT NULL,
        "teachingAssignmentId" uuid NOT NULL,
        "classRoomId" uuid NOT NULL,
        "teacherId" uuid NOT NULL,
        "dayOfWeek" integer NOT NULL,
        "timeSlotId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_schedule_entries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_schedule_class_slot"
          UNIQUE ("academicYearId", "classRoomId", "dayOfWeek", "timeSlotId"),
        CONSTRAINT "UQ_schedule_teacher_slot"
          UNIQUE ("academicYearId", "teacherId", "dayOfWeek", "timeSlotId")
      )
    `);

    for (const [column, table] of [
      ['schoolId', 'schools'],
      ['academicYearId', 'academic_years'],
      ['teachingAssignmentId', 'teaching_assignments'],
      ['classRoomId', 'classrooms'],
      ['teacherId', 'users'],
      ['timeSlotId', 'time_slots'],
    ]) {
      await queryRunner.query(`
        ALTER TABLE "schedule_entries"
        ADD CONSTRAINT "FK_schedule_entries_${column}"
        FOREIGN KEY ("${column}") REFERENCES "${table}"("id") ON DELETE CASCADE
      `);
    }

    await queryRunner.query(`
      CREATE INDEX "IDX_schedule_entries_class"
      ON "schedule_entries" ("schoolId", "academicYearId", "classRoomId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "schedule_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "time_slots"`);
  }
}
