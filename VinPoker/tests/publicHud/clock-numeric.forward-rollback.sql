-- Recovery TEMPLATE before clock-counts.forward-rollback.sql.
-- Production recovery needs a reviewed controlled migration.
-- On bigint source schemas, never commit this reversal alone: the intermediate
-- PL/pgSQL reader has the known42804 defect. Restore032 then025 in the SAME
-- transaction to recover the compatible SQL reader before exposing it.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $restore_clock_numeric$
DECLARE item record;
BEGIN
 SELECT * INTO STRICT item FROM spectator_projection_v2.clock_numeric_original_v1;
 IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),''))<>item.candidate_definition_hash
 OR md5(item.definition)<>item.original_definition_hash
 THEN RAISE EXCEPTION 'clock_numeric_recovery_drift';END IF;
 EXECUTE item.definition;
 IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),''))<>item.original_definition_hash
 THEN RAISE EXCEPTION 'clock_numeric_recovery_differs';END IF;
END $restore_clock_numeric$;
COMMIT;
