-- Keep current component-generation lookups on a small index while retaining
-- historical entity markers for guarded rollback. No source writer, generation,
-- fencing, RLS, ACL or public contract changes. No production apply is authorized.
-- The atomic CREATE INDEX takes a regular write-blocking table lock during the
-- build (5s lock acquisition / 60s statement limit); this is not an online build.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF md5(replace(pg_get_functiondef('spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure),chr(13),''))<>'e5684f8818e0d536bcdde7842032f71d'
 OR to_regclass('spectator_projection_v2.idx_compact_generation_lookup_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'Compact generation lookup catalog differs';
 END IF;
END $guard$;
CREATE INDEX idx_compact_generation_lookup_v1
 ON spectator_projection_v2.entity_markers(tournament_id,component)
 WHERE entity_key='generation';
COMMIT;
