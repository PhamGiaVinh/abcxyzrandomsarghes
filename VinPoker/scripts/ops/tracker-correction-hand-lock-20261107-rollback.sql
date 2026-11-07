-- Pause and drain correction writers before restoring the old lock behavior.
-- Preserves hand/action/receipt/audit rows and migration ledger receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $lock_order_recovery$
DECLARE
 target oid:=to_regprocedure('public._tracker_correction_uat_context(uuid,uuid,uuid,text)');
 definition text;
 original_body text;
 old_select text:='  SELECT t.club_id,';
 new_select text:=E'  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''tracker_correction_hand_v1:''||p_hand_id::text,0));\n  SELECT t.club_id,';
BEGIN
 SELECT pg_get_functiondef(p.oid),replace(p.prosrc,chr(13),'') INTO definition,original_body
 FROM pg_proc p WHERE p.oid=target
  AND md5(replace(p.prosrc,chr(13),''))='6fbc46ed8c9b7712a4546480a07385ae'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
  AND p.proconfig=ARRAY['search_path=""']::text[]
  AND p.proacl=ARRAY['postgres=X/postgres']::aclitem[];
 IF definition IS NULL OR (length(original_body)-length(replace(original_body,new_select,'')))<>length(new_select) THEN
  RAISE EXCEPTION 'tracker_correction_context_recovery_drift';
 END IF;
 EXECUTE replace(definition,new_select,old_select);
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target
  AND md5(replace(p.prosrc,chr(13),''))='2e3c0d73bce278f80a8983d3a425f206'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
  AND p.proconfig=ARRAY['search_path=""']::text[]
  AND p.proacl=ARRAY['postgres=X/postgres']::aclitem[]) THEN
  RAISE EXCEPTION 'tracker_correction_context_recovery_postimage_drift';
 END IF;
END $lock_order_recovery$;
COMMIT;
