-- PENDING LOCAL CANDIDATE, CLI scaffold 20261029074734. Not promoted to the
-- active forward ledger. No timestamp backfill or migration-time data update.
-- Rollback: restore saved definition in a reviewed forward migration; preserve
-- completed marker/history rows and stop new automatic acquisition if needed.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
DO $preflight$
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.end_expired_breaks(uuid)'::regprocedure))
      IS DISTINCT FROM '1299cb045c75d3c64bafc25d6d2bafba'
    OR to_regclass('floor_private.expired_rest_marker_definition_backup_v1') IS NOT NULL
  THEN RAISE EXCEPTION 'expired_rest_marker_definition_drift_or_collision'; END IF;
END;
$preflight$;
CREATE TABLE floor_private.expired_rest_marker_definition_backup_v1 (
  signature text PRIMARY KEY,
  definition text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON floor_private.expired_rest_marker_definition_backup_v1
  FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO floor_private.expired_rest_marker_definition_backup_v1(signature, definition)
VALUES ('public.end_expired_breaks(uuid)', pg_get_functiondef('public.end_expired_breaks(uuid)'::regprocedure));

CREATE OR REPLACE FUNCTION public.end_expired_breaks(p_club_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(attendance_id uuid, dealer_name text, break_start timestamptz, expected_duration_minutes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  attendance_row record;
  break_row public.dealer_breaks%ROWTYPE;
  ended_at timestamptz;
BEGIN
  -- Lock attendance before its break, matching close/manual break operations.
  -- Concurrent callers skip a held row and can safely retry on the next tick.
  FOR attendance_row IN
    SELECT att.id, att.current_state, d.full_name
    FROM public.dealer_attendance att JOIN public.dealers d ON d.id = att.dealer_id
    WHERE att.status = 'checked_in' AND att.check_out_time IS NULL
      AND att.current_state IN ('on_break', 'available')
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
      AND EXISTS(SELECT 1 FROM public.dealer_breaks b
        LEFT JOIN public.dealer_assignments a ON a.id = b.assignment_id
        WHERE coalesce(b.attendance_id, a.attendance_id) = att.id AND b.break_end IS NULL)
    ORDER BY att.id FOR UPDATE OF att SKIP LOCKED LOOP
    SELECT b.* INTO break_row FROM public.dealer_breaks b
      LEFT JOIN public.dealer_assignments a ON a.id = b.assignment_id
      WHERE coalesce(b.attendance_id, a.attendance_id) = attendance_row.id AND b.break_end IS NULL
      ORDER BY b.break_start DESC, b.id DESC LIMIT 1 FOR UPDATE OF b;
    ended_at := clock_timestamp();
    IF NOT FOUND OR break_row.expected_duration_minutes <= 0
      OR ended_at < break_row.break_start + make_interval(mins => break_row.expected_duration_minutes)
      OR EXISTS(SELECT 1 FROM public.dealer_assignments a
        WHERE a.attendance_id = attendance_row.id AND a.released_at IS NULL AND a.status = 'assigned') THEN
      CONTINUE;
    END IF;
    UPDATE public.dealer_breaks b SET break_end = ended_at
      WHERE b.id = break_row.id AND b.break_end IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    -- Older workers may already have returned an unassigned dealer to the pool
    -- while leaving this marker open. Complete it at the actual current clock;
    -- do not rewind time, re-credit rest or emit another ready transition.
    IF attendance_row.current_state = 'on_break' THEN
      UPDATE public.dealer_attendance att SET current_state = 'available',
        priority_break_flag = false, worked_minutes_since_last_break = 0,
        pool_entered_at = ended_at, updated_at = ended_at
        WHERE att.id = attendance_row.id AND att.current_state = 'on_break';
      attendance_id := attendance_row.id;
      dealer_name := attendance_row.full_name;
      break_start := break_row.break_start;
      expected_duration_minutes := break_row.expected_duration_minutes;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;
-- CREATE OR REPLACE preserves existing owner/ACL. This candidate does not
-- add roles or widen EXECUTE privileges; qualification compares them exactly.
COMMIT;
