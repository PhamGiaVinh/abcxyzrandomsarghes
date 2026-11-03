-- PENDING LOCAL CANDIDATE; CLI scaffold 20261029082610. Not active ledger.
-- Continuous rest starts when the most recent assignment was released, not
-- when its break ended. Never rewrite historical markers or attendance.
-- Rollback: forward restore the saved definition; no data rollback required.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $patch$
DECLARE before_row record; after_row record; definition text; patched text;
 old_query text:=$old$  -- Get last break end time
  SELECT MAX(break_end) INTO v_last_break_end
  FROM   public.dealer_breaks db
  JOIN   public.dealer_assignments da ON da.id = db.assignment_id
  WHERE  da.attendance_id = p_attendance_id;$old$;
 new_query text:=$new$  -- Continuous rest begins at the latest release, including its actual break.
  SELECT MAX(da.released_at) INTO v_last_break_end
  FROM public.dealer_assignments da
  WHERE da.attendance_id = p_attendance_id AND da.released_at IS NOT NULL;$new$;
 old_calc text:=$old$  v_rest_min := EXTRACT(EPOCH FROM (now() - COALESCE(v_last_break_end, v_check_in_time, now())))::INT / 60;$old$;
 new_calc text:=$new$  v_rest_min := floor(greatest(0, EXTRACT(EPOCH FROM
    (now() - COALESCE(greatest(v_last_break_end, v_check_in_time), now())))) / 60)::integer;$new$;
BEGIN
 SELECT p.*,replace(pg_get_functiondef(p.oid),chr(13),'') AS definition INTO STRICT before_row
 FROM pg_proc p WHERE oid='public.atomic_dealer_ready_check(uuid,uuid)'::regprocedure;
 IF current_user<>'postgres' OR md5(before_row.prosrc)<>'f261c254bfc1bafd29760095f8402891'
 OR pg_get_userbyid(before_row.proowner)<>'postgres'
 OR to_regclass('floor_private.ready_rest_anchor_definition_backup_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'dealer_ready_rest_anchor_drift_or_collision';
 END IF;
 definition:=before_row.definition;
 IF cardinality(string_to_array(definition,old_query))<>2 OR cardinality(string_to_array(definition,old_calc))<>2 THEN
  RAISE EXCEPTION 'dealer_ready_rest_anchor_patch_drift';
 END IF;
 CREATE TABLE floor_private.ready_rest_anchor_definition_backup_v1(
  signature text PRIMARY KEY, definition text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 REVOKE ALL ON floor_private.ready_rest_anchor_definition_backup_v1 FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.ready_rest_anchor_definition_backup_v1(signature,definition)
 VALUES('public.atomic_dealer_ready_check(uuid,uuid)',definition);
 patched:=replace(replace(definition,old_query,new_query),old_calc,new_calc);
 patched:=replace(patched,'v_last_break_end','v_last_release');
 EXECUTE patched;
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=before_row.oid;
 IF after_row.prosrc IS NOT DISTINCT FROM before_row.prosrc OR after_row.proacl IS DISTINCT FROM before_row.proacl
 OR after_row.proowner<>before_row.proowner OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef
 OR after_row.proconfig IS DISTINCT FROM before_row.proconfig OR after_row.provolatile IS DISTINCT FROM before_row.provolatile THEN
  RAISE EXCEPTION 'dealer_ready_rest_anchor_metadata_changed';
 END IF;
END;
$patch$;
COMMIT;
