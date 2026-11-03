-- Recovery TEMPLATE. Use a new reviewed/versioned controlled migration if
-- production recovery is needed; never edit/replay an applied migration.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $restore_read_plans$
DECLARE item record;
BEGIN
 FOR item IN SELECT * FROM spectator_projection_v2.read_plan_originals_v1 ORDER BY signature LOOP
  IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),''))<>item.wrapped_definition_hash
  THEN RAISE EXCEPTION 'public_read_plan_recovery_drift'; END IF;
  EXECUTE item.definition;
 END LOOP;
END $restore_read_plans$;
COMMIT;
