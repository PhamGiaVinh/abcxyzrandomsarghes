-- Recovery TEMPLATE, applied before read-plans.forward-rollback.sql.
-- A production recovery requires a new reviewed controlled migration.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $restore_clock_plan$
DECLARE item record;
BEGIN
 SELECT * INTO STRICT item FROM spectator_projection_v2.clock_read_plan_original_v1;
 IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),''))<>item.wrapped_definition_hash
 THEN RAISE EXCEPTION 'clock_read_plan_recovery_drift'; END IF;
 EXECUTE item.definition;
 IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),''))<>item.original_definition_hash
 THEN RAISE EXCEPTION 'clock_read_plan_recovery_differs'; END IF;
END $restore_clock_plan$;
COMMIT;
