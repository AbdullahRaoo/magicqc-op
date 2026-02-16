-- Migration: Ensure soft-delete infrastructure for measurements table
--
-- CONTEXT: The measurements table uses Laravel SoftDeletes (deleted_at column).
-- The Admin Panel soft-deletes measurements by setting deleted_at = NOW().
-- Ghost POMs appeared in the Operator Panel because SQL queries were JOINing
-- measurement_sizes with measurements WITHOUT filtering out soft-deleted rows.
--
-- FIX (applied in code): Every SQL query that touches measurements now includes:
--   AND m.deleted_at IS NULL   (or equivalent in the JOIN ON clause)
--
-- This migration ensures the deleted_at column exists and is indexed for performance,
-- and adds an index on measurement_sizes.measurement_id for fast JOINs.

-- 1. Ensure deleted_at column exists on measurements (Laravel SoftDeletes)
-- If your schema already has this column (from Laravel migration), this will be a no-op.
-- If not, add it:
ALTER TABLE measurements
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL DEFAULT NULL;

-- 2. Add index on deleted_at for fast filtering of active vs soft-deleted rows
CREATE INDEX IF NOT EXISTS idx_measurements_deleted_at
  ON measurements (deleted_at);

-- 3. Composite index for the most common query pattern: article_id + deleted_at
CREATE INDEX IF NOT EXISTS idx_measurements_article_active
  ON measurements (article_id, deleted_at);

-- 4. Index on measurement_sizes.measurement_id for fast JOIN performance
CREATE INDEX IF NOT EXISTS idx_measurement_sizes_measurement_id
  ON measurement_sizes (measurement_id);

-- 5. Diagnostic: Show soft-deleted measurements (should match what admin deleted)
SELECT m.id, m.code, m.measurement, m.article_id, m.deleted_at
FROM measurements m
WHERE m.deleted_at IS NOT NULL
ORDER BY m.deleted_at DESC
LIMIT 20;
