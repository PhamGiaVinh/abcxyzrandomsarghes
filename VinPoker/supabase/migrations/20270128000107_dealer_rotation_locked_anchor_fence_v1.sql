-- CLI candidate 20261016020132, reserved107 after local catalog collision check.
-- Preserve87's session fence. A sticky announced slot may anchor forecasts only
-- when its exact identity/version/session/dealers/relief still match under the
-- existing physical -> session -> schedule -> assignment locks. No new writes
-- to announced slots or rest/payroll/flags. DB107 must precede the new worker.
-- Recovery: contain workers and restore captured pre107 definition/grants plus
-- compatible worker artifact. Keep all schedule/audit data; never replay87.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE original text; patched text; anchor text; guarded text;
BEGIN
 SELECT replace(pg_get_functiondef('public.upsert_rotation_plan(uuid,uuid,jsonb,uuid[])'::regprocedure),chr(13),'') INTO original;
 IF md5(original)<>'f1df3b68a09450501dc5f66a2644ec5b' THEN
   RAISE EXCEPTION 'rotation_locked_anchor_definition_drift';
 END IF;
 anchor:='AND a.swing_processed_at IS NULL AND s.closed_at IS NULL';
 guarded:=$guard$AND a.swing_processed_at IS NULL AND s.closed_at IS NULL
            AND (NOT (r ? 'locked_anchor') OR (
              r->>'locked_anchor'='true'
              AND a.table_session_id=NULLIF(r->>'table_session_id','')::uuid
              AND a.attendance_id=NULLIF(r->>'out_attendance_id','')::uuid
              AND a.pre_assigned_attendance_id=NULLIF(r->>'in_attendance_id','')::uuid
              AND a.planned_relief_at=(r->>'planned_relief_at')::timestamptz
              AND EXISTS(SELECT 1 FROM public.dealer_rotation_schedule locked
                WHERE locked.id=NULLIF(r->>'locked_schedule_id','')::uuid
                  AND locked.version=NULLIF(r->>'locked_schedule_version','')::integer
                  AND locked.club_id=p_club_id AND locked.table_id=v_table
                  AND locked.assignment_id=a.id AND locked.slot_index=0
                  AND locked.status='announced'
                  AND locked.out_attendance_id=a.attendance_id
                  AND locked.in_attendance_id=a.pre_assigned_attendance_id
                  AND locked.planned_relief_at=a.planned_relief_at)
            ))$guard$;
 IF (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 THEN
   RAISE EXCEPTION 'rotation_locked_anchor_patch_anchor_missing';
 END IF;
 patched:=replace(original,anchor,guarded);
 EXECUTE patched;
END $migration$;
COMMIT;
