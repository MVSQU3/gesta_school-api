-- =============================================================================
-- Rattachement des élèves à leur établissement
-- =============================================================================
--
-- CONTEXTE
--   La table `students` ne portait aucun `schoolId`. Conséquences :
--     - supprimer une école laissait ses élèves orphelins en base ;
--     - aucun cloisonnement multi-tenant au niveau de l'élève lui-même.
--
-- À EXÉCUTER UNE SEULE FOIS, AVANT de démarrer l'API avec la nouvelle entité
-- Student. L'ordre importe : `synchronize: true` supprimerait une colonne
-- qu'il ne connaît pas encore, et refuserait d'ajouter une colonne NOT NULL
-- sur une table déjà peuplée.
--
--   psql "$DATABASE_URL" -f sql/2026-08-02-students-school-id.sql
--
-- Le script est transactionnel : en cas d'échec, rien n'est appliqué.
-- Il est idempotent : le relancer sur une base déjà migrée ne fait rien.
-- =============================================================================

BEGIN;

-- 1. La colonne est d'abord ajoutée nullable, le temps du remplissage.
ALTER TABLE students ADD COLUMN IF NOT EXISTS "schoolId" uuid;

-- 2. Garde-fou : un élève inscrit dans PLUSIEURS écoles ne peut pas être
--    rattaché à une seule d'entre elles sans casser le cloisonnement de
--    l'autre. Ce cas ne devrait pas exister ; s'il existe, on interrompt
--    plutôt que de corrompre silencieusement les données.
DO $$
DECLARE
  multi_school_count integer;
BEGIN
  SELECT COUNT(*) INTO multi_school_count
  FROM (
    SELECT e."studentId"
    FROM enrollments e
    JOIN students s ON s.id = e."studentId"
    WHERE s."schoolId" IS NULL
    GROUP BY e."studentId"
    HAVING COUNT(DISTINCT e."schoolId") > 1
  ) AS multi;

  IF multi_school_count > 0 THEN
    RAISE EXCEPTION
      'Migration interrompue : % élève(s) sont inscrits dans plusieurs écoles. Dédoublonnez-les manuellement (une fiche par école) avant de relancer.',
      multi_school_count;
  END IF;
END $$;

-- 3. Rattachement depuis la première inscription connue de l'élève.
UPDATE students s
   SET "schoolId" = (
         SELECT e."schoolId"
           FROM enrollments e
          WHERE e."studentId" = s.id
          ORDER BY e."createdAt" ASC
          LIMIT 1
       )
 WHERE s."schoolId" IS NULL;

-- 4. Suppression des élèves orphelins : aucune inscription, donc aucune école
--    de rattachement possible. Ce sont les résidus laissés par les
--    suppressions d'écoles antérieures.
DELETE FROM students WHERE "schoolId" IS NULL;

-- 5. La contrainte peut maintenant être posée. La clé étrangère elle-même
--    (ON DELETE CASCADE) sera créée par TypeORM au premier démarrage.
ALTER TABLE students ALTER COLUMN "schoolId" SET NOT NULL;

COMMIT;
