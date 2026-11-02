-- CLI generated20261025084124; reserved292 after source291/catalog inspection.
-- LOCAL candidate: filter fallback by the SAME operating-day/shift/duplicate
-- attendance predicate already enforced by the acquisition trigger. Rest,
-- priority, OT, pool override and duration policies are deliberately unchanged.
-- Recovery: restore the captured exact predecessor definition only after
-- matching the installed body digest; preserve all attendance/assignment/audit.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $patch$
DECLARE sig regprocedure:='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
 definition text;old_owner oid;old_acl aclitem[];old_config text[];
 needle text:=$needle$      AND dat.check_out_time IS NULL
      AND public._assert_dealer_allowed_for_table(v_table_id, dat.dealer_id)$needle$;
 replacement text:=$replacement$      AND dat.check_out_time IS NULL
      AND floor_private.dealer_pool_attendance_matches_v1(dat.dealer_id, v_club_id, pg_catalog.statement_timestamp())
      AND public._assert_dealer_allowed_for_table(v_table_id, dat.dealer_id)$replacement$;
BEGIN
 IF md5(pg_get_functiondef(sig))<>'58430628220aa26d854fdab0694394bd'
  OR md5(pg_get_functiondef('floor_private.dealer_pool_attendance_matches_v1(uuid,uuid,timestamptz)'::regprocedure))<>'380e30a5877e74edfdcb15c879856f59' THEN
  RAISE EXCEPTION 'dealer_fallback292_dependency_drift'; END IF;
 SELECT pg_get_functiondef(oid),proowner,proacl,proconfig INTO definition,old_owner,old_acl,old_config FROM pg_proc WHERE oid=sig;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'dealer_fallback292_patch_anchor_not_unique'; END IF;
 EXECUTE replace(definition,needle,replacement);
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=sig AND proowner=old_owner AND proacl IS NOT DISTINCT FROM old_acl AND proconfig IS NOT DISTINCT FROM old_config) THEN
  RAISE EXCEPTION 'dealer_fallback292_catalog_metadata_changed'; END IF;
END $patch$;
COMMIT;
