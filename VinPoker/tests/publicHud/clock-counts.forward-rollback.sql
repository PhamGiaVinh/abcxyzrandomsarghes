-- Recovery TEMPLATE before025 and read-plans.forward-rollback.sql.
-- Production recovery requires its own reviewed controlled migration.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $restore_clock_counts$
DECLARE item record;
BEGIN
 SELECT * INTO STRICT item FROM spectator_projection_v2.clock_counts_original_v1;
 IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),''))<>item.candidate_definition_hash
 THEN RAISE EXCEPTION 'clock_counts_recovery_drift';END IF;
 EXECUTE item.definition;
 IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),''))<>item.original_definition_hash
 THEN RAISE EXCEPTION 'clock_counts_recovery_differs';END IF;
END $restore_clock_counts$;
COMMIT;
