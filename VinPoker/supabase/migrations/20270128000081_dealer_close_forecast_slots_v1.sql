-- Forward81 after79. Repro38619712270: normal predicted forecast slots have
-- NULL assignment, unlike slot0. Preserve strict slot0 and incoming guards.
-- No historical rows, rest/payroll/time/grant changes. Restore with reviewed
-- prior full object only after acquisition containment; never revive plans.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $repair$
DECLARE original text; corrected text; old_guard text; new_guard text;
BEGIN
 SELECT pg_get_functiondef('public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure) INTO original;
 IF md5(original)<>'70b3e4bb3bc85973152e8ed21fae4438' THEN RAISE EXCEPTION 'close_forecast_definition_drift'; END IF;
 corrected:=replace(original,'rs.status,rs.assignment_id,rs.in_attendance_id,','rs.status,rs.assignment_id,rs.in_attendance_id,rs.slot_index,');
 old_guard:=$old$        OR plan_row.assignment_club_id IS DISTINCT FROM v_session.club_id
        OR plan_row.assignment_table_id IS DISTINCT FROM v_session.game_table_id
        OR plan_row.assignment_session_id IS DISTINCT FROM v_session.id THEN$old$;
 new_guard:=$new$        OR (plan_row.slot_index=0 AND (
          plan_row.assignment_club_id IS DISTINCT FROM v_session.club_id
          OR plan_row.assignment_table_id IS DISTINCT FROM v_session.game_table_id
          OR plan_row.assignment_session_id IS DISTINCT FROM v_session.id))
        OR (plan_row.slot_index>0 AND (
          plan_row.status IS DISTINCT FROM 'predicted'
          OR plan_row.assignment_id IS NOT NULL)) THEN$new$;
 corrected:=replace(corrected,old_guard,new_guard);
 IF corrected=original OR position(old_guard IN corrected)>0
  OR position('plan_row.slot_index>0' IN corrected)=0 THEN RAISE EXCEPTION 'close_forecast_patch_missing'; END IF;
 EXECUTE corrected;
 IF position('plan_row.slot_index>0' IN pg_get_functiondef('public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'close_forecast_postcheck_failed';
 END IF;
END $repair$;
COMMIT;
