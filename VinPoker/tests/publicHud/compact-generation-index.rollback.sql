-- Approved rollback / isolated test only. Removes this derived lookup index.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $rollback$ BEGIN
 IF md5(pg_get_indexdef(to_regclass('spectator_projection_v2.idx_compact_generation_lookup_v1'))) IS DISTINCT FROM 'ab83ab3c2b71e3586fa6bc40e5b08514'
 OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('spectator_projection_v2.idx_compact_generation_lookup_v1') AND indisvalid AND indisready) THEN
  RAISE EXCEPTION 'Compact generation lookup reverse catalog differs';
 END IF;
END $rollback$;
DROP INDEX spectator_projection_v2.idx_compact_generation_lookup_v1;
COMMIT;
