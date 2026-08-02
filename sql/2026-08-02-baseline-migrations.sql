-- =============================================================================
-- Mise en place des migrations sur une base existante (« baseline »)
-- =============================================================================
--
-- CONTEXTE
--   Jusqu'ici le schéma était créé par `synchronize: true`. Les tables existent
--   donc déjà. La migration InitialSchema décrit ce même schéma : l'exécuter
--   telle quelle échouerait (les tables existent), alors qu'elle ne doit rien
--   changer.
--
--   Ce script se contente d'enregistrer InitialSchema comme DÉJÀ APPLIQUÉE.
--   Aucune table n'est créée, modifiée ni supprimée.
--
-- À EXÉCUTER UNE SEULE FOIS, sur chaque base créée avant la mise en place des
-- migrations. Sur une base vierge, ne PAS l'exécuter : lancez simplement
-- `npm run migration:run`, qui créera le schéma normalement.
--
--   psql "$DATABASE_URL" -f sql/2026-08-02-baseline-migrations.sql
--
-- Le script est transactionnel et idempotent : le relancer ne fait rien.
-- =============================================================================

BEGIN;

-- Table de suivi des migrations, telle que TypeORM la crée.
CREATE TABLE IF NOT EXISTS "migrations" (
  "id"        SERIAL       NOT NULL,
  "timestamp" BIGINT       NOT NULL,
  "name"      VARCHAR      NOT NULL,
  CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY ("id")
);

-- Garde-fou : on ne « baseline » qu'une base déjà pourvue du schéma.
-- Sur une base vierge, ce script masquerait la création réelle des tables.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schools'
  ) THEN
    RAISE EXCEPTION
      'Base vierge détectée : n''exécutez pas ce script. Lancez « npm run migration:run » pour créer le schéma.';
  END IF;
END $$;

-- Enregistrement de la migration initiale comme déjà appliquée.
INSERT INTO "migrations" ("timestamp", "name")
SELECT 1785700900989, 'InitialSchema1785700900989'
 WHERE NOT EXISTS (
   SELECT 1 FROM "migrations" WHERE "name" = 'InitialSchema1785700900989'
 );

COMMIT;
