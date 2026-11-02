-- CLI candidate20261018225132, local reservation173 after172.
-- LOCAL ONLY. Read projection joins the existing canonical inventory; no
-- assignment/attendance/rest/rotation writes or policy changes.
-- Emergency recovery: suspend both read RPCs with dealerPrediction172.suspend.sql;
-- never restore an anonymous or stale-incarnation projection.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $repair$
DECLARE target regprocedure:='public.get_table_assignments_with_next(uuid)'::regprocedure;
 p record; definition text; seam text; replacement text;
BEGIN
 SELECT prosrc,proowner,prosecdef,proconfig,proacl INTO p FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR md5(p.prosrc) IS DISTINCT FROM '989867fd414c37b147deed0fd92a68cf'
  OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR has_function_privilege('anon',target,'EXECUTE')
  OR to_regprocedure('floor_private.club_operational_inventory(uuid)') IS NULL THEN
  RAISE EXCEPTION 'prediction173_definition_or_dependency_drift';END IF;
 definition:=pg_get_functiondef(target);
 seam:='JOIN public.game_tables gt ON gt.id=da.table_id';
 replacement:=seam||E'\n JOIN floor_private.club_operational_inventory(p_club_id) operational ON operational.game_table_id=gt.id\n  AND operational.availability_status=''in_use'' AND operational.active_dealer_assignment_id=da.id\n  AND operational.table_session_id=da.table_session_id';
 IF (length(definition)-length(replace(definition,seam,'')))/length(seam)<>1 THEN RAISE EXCEPTION 'prediction173_inventory_seam_drift';END IF;
 definition:=replace(definition,seam,replacement);
 seam:='LEFT JOIN public.dealer_attendance att_next ON att_next.id=da.pre_assigned_attendance_id';
 replacement:=seam||E'\n  AND att_next.status=''checked_in'' AND att_next.check_out_time IS NULL\n  AND EXISTS(SELECT 1 FROM public.dealer_shifts next_shift WHERE next_shift.id=att_next.shift_id AND next_shift.club_id=gt.club_id)';
 IF (length(definition)-length(replace(definition,seam,'')))/length(seam)<>1 THEN RAISE EXCEPTION 'prediction173_attendance_seam_drift';END IF;
 definition:=replace(definition,seam,replacement);
 seam:='LEFT JOIN public.dealers d_next ON d_next.id=att_next.dealer_id';
 replacement:=seam||E'\n  AND d_next.club_id=gt.club_id AND d_next.status=''active'' AND d_next.deleted_at IS NULL';
 IF (length(definition)-length(replace(definition,seam,'')))/length(seam)<>1 THEN RAISE EXCEPTION 'prediction173_dealer_seam_drift';END IF;
 EXECUTE replace(definition,seam,replacement);
 IF EXISTS(SELECT 1 FROM pg_proc updated WHERE updated.oid=target AND
  (updated.proacl IS DISTINCT FROM p.proacl OR updated.proconfig IS DISTINCT FROM p.proconfig
   OR updated.proowner IS DISTINCT FROM p.proowner OR updated.prosecdef IS DISTINCT FROM p.prosecdef)) THEN
  RAISE EXCEPTION 'prediction173_metadata_drift';END IF;
END;
$repair$;
COMMIT;
