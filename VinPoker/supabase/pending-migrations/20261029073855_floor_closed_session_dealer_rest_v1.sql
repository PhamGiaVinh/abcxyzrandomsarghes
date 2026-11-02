-- PENDING LOCAL CANDIDATE. CLI scaffold 20261029073855; not an active
-- forward-ledger version. Qualify on an owned clone before catalog promotion.
-- New tournament closes start an explicit rest; historical rows are untouched.
-- Rollback: stop new close writes, restore the exact saved definition below in
-- a reviewed forward migration, preserve all created rest/audit history.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
DO $preflight$
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid =
      'floor_private.reconcile_closed_session_attendance_v1()'::regprocedure))
      IS DISTINCT FROM '1acf34b514430871452c5375f78d8b5a'
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid =
      'floor_private.reconcile_closed_session_attendance_v1()'::regprocedure
      AND prosecdef AND proowner = 'postgres'::regrole)
    OR has_function_privilege('authenticated',
      'floor_private.reconcile_closed_session_attendance_v1()', 'EXECUTE')
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.table_sessions'::regclass
      AND tgname = 'trg_reconcile_closed_session_attendance_v1' AND NOT tgisinternal) <> 1
    OR to_regclass('floor_private.closed_session_rest_definition_backup_v1') IS NOT NULL
  THEN RAISE EXCEPTION 'closed_session_rest_definition_drift_or_collision'; END IF;
END;
$preflight$;

CREATE TABLE floor_private.closed_session_rest_definition_backup_v1 (
  signature text PRIMARY KEY,
  definition text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON floor_private.closed_session_rest_definition_backup_v1
  FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO floor_private.closed_session_rest_definition_backup_v1(signature, definition)
VALUES ('floor_private.reconcile_closed_session_attendance_v1()',
  pg_get_functiondef('floor_private.reconcile_closed_session_attendance_v1()'::regprocedure));

CREATE OR REPLACE FUNCTION floor_private.reconcile_closed_session_attendance_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  attendance_row public.dealer_attendance%ROWTYPE;
  released_assignment uuid;
  rest_minutes integer;
  rest_started_at timestamptz;
BEGIN
  IF OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.dealer_assignments a
    LEFT JOIN public.dealer_attendance dat ON dat.id = a.attendance_id
    LEFT JOIN public.dealers d ON d.id = dat.dealer_id
    WHERE a.table_session_id = NEW.id AND
      (a.club_id IS DISTINCT FROM NEW.club_id OR a.table_id IS DISTINCT FROM NEW.game_table_id
       OR dat.id IS NULL OR a.dealer_id IS DISTINCT FROM dat.dealer_id
       OR d.club_id IS DISTINCT FROM NEW.club_id OR a.released_at IS NULL)) THEN
    RAISE EXCEPTION 'closed_session_dealer_context_invalid';
  END IF;
  -- Preserve physical/session -> attendance lock order of the canonical close.
  FOR attendance_row IN SELECT dat.* FROM public.dealer_attendance dat
    WHERE EXISTS(SELECT 1 FROM public.dealer_assignments a
      WHERE a.table_session_id = NEW.id AND a.attendance_id = dat.id AND a.released_at IS NOT NULL)
    ORDER BY dat.id FOR UPDATE LOOP
    IF attendance_row.status = 'checked_in' AND attendance_row.check_out_time IS NULL
      AND attendance_row.current_state = 'assigned'
      AND attendance_row.pre_assigned_table_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.dealer_assignments a
        WHERE a.attendance_id = attendance_row.id AND a.released_at IS NULL
          AND a.status IN ('assigned', 'on_break', 'pre_assigned', 'reserved')) THEN
      IF NEW.session_type = 'tournament' THEN
        -- A stale open marker must not become credit for this new rest.
        IF EXISTS(SELECT 1 FROM public.dealer_breaks b
          LEFT JOIN public.dealer_assignments a ON a.id = b.assignment_id
          WHERE coalesce(b.attendance_id, a.attendance_id) = attendance_row.id
            AND b.break_end IS NULL) THEN
          RAISE EXCEPTION 'floor_close_dealer_open_break_conflict';
        END IF;
        SELECT a.id INTO STRICT released_assignment FROM public.dealer_assignments a
          WHERE a.table_session_id = NEW.id AND a.attendance_id = attendance_row.id
            AND a.released_at IS NOT NULL
          ORDER BY a.released_at DESC, a.assigned_at DESC, a.id LIMIT 1;
        SELECT greatest(15, coalesce(c.break_duration_minutes, 15),
          coalesce(c.min_inter_swing_rest_minutes, 15)) INTO rest_minutes
          FROM public.swing_config c WHERE c.club_id = NEW.club_id AND c.table_type = 'tournament';
        rest_minutes := coalesce(rest_minutes, 15);
        rest_started_at := clock_timestamp();
        INSERT INTO public.dealer_breaks(assignment_id, attendance_id, club_id,
          break_start, expected_duration_minutes, reason)
        VALUES(released_assignment, attendance_row.id, NEW.club_id,
          rest_started_at, rest_minutes, 'floor_tournament_table_closed');
        UPDATE public.dealer_attendance SET current_state = 'on_break'
          WHERE id = attendance_row.id AND current_state = 'assigned';
      ELSE
        -- This candidate changes tournament operations only.
        UPDATE public.dealer_attendance SET current_state = 'available'
          WHERE id = attendance_row.id AND current_state = 'assigned';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION floor_private.reconcile_closed_session_attendance_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.reconcile_closed_session_attendance_v1()
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
