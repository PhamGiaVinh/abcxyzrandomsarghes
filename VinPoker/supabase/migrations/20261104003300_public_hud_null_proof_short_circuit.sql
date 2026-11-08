-- Missing settlement proof is unknown. Avoid invoking the numeric validator
-- repeatedly for SQL NULL values in each history row; JSON null still runs it.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.safe_integer(jsonb)'::regprocedure),chr(13),''))<>'c7ed2c1ef058520538fb54ef48bfc2d0' THEN
  RAISE EXCEPTION 'HUD numeric validator preimage differs';
 END IF;
END $guard$;
ALTER FUNCTION tracker_analytics_v1.safe_integer(jsonb) STRICT;
COMMIT;
