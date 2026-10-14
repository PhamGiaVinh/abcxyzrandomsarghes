-- Forward79: reproduce38610895416, successful canonical close strands next dealer.
-- No historical backfill, attendance time, rest, payroll or public grant change.
-- Restore: reviewed forward replacement with the captured prior function only
-- after automatic/manual acquisition containment; never resurrect old reservations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $repair$
DECLARE original text; corrected text; anchor text; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure) INTO original;
 IF md5(original)<>'7724e5d9abd44d876f990e2521830582' THEN
  RAISE EXCEPTION 'dealer_close_definition_drift';
 END IF;
 anchor:=E'  UPDATE public.dealer_assignments\n  SET released_at = COALESCE(released_at, pg_catalog.now()),';
 replacement:=$patch$  -- Lock schedule before assignment/attendance, matching rotation writers.
  -- Physical/session locks are already held by this canonical close.
  DECLARE plan_row record; cancel_result jsonb; legacy_row record; incoming_row record;
  BEGIN
    FOR plan_row IN
      SELECT rs.id,rs.club_id,rs.table_id,rs.status,rs.assignment_id,rs.in_attendance_id,
        a.club_id AS assignment_club_id,a.table_id AS assignment_table_id,
        a.table_session_id AS assignment_session_id
      FROM public.dealer_rotation_schedule rs
      LEFT JOIN public.dealer_assignments a ON a.id=rs.assignment_id
      WHERE (a.table_session_id=v_session.id OR rs.table_id=v_session.game_table_id)
        AND rs.status IN ('predicted','announced','executing')
      ORDER BY rs.id FOR UPDATE OF rs
    LOOP
      IF plan_row.club_id IS DISTINCT FROM v_session.club_id
        OR plan_row.table_id IS DISTINCT FROM v_session.game_table_id
        OR plan_row.assignment_club_id IS DISTINCT FROM v_session.club_id
        OR plan_row.assignment_table_id IS DISTINCT FROM v_session.game_table_id
        OR plan_row.assignment_session_id IS DISTINCT FROM v_session.id THEN
        RAISE EXCEPTION 'closed_session_rotation_scope_invalid';
      END IF;
      IF plan_row.status='executing' THEN
        RAISE EXCEPTION 'closed_session_rotation_executing';
      END IF;
      IF plan_row.status='announced' THEN
        PERFORM 1 FROM public.dealer_assignments a WHERE a.id=plan_row.assignment_id
          AND a.table_session_id=v_session.id AND a.club_id=v_session.club_id
          AND a.table_id=v_session.game_table_id AND a.released_at IS NULL
          AND a.pre_assigned_attendance_id=plan_row.in_attendance_id
          AND a.attendance_id IS DISTINCT FROM plan_row.in_attendance_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'closed_session_announced_assignment_invalid'; END IF;
        SELECT da.*,d.club_id AS dealer_club_id INTO incoming_row
        FROM public.dealer_attendance da JOIN public.dealers d ON d.id=da.dealer_id
        WHERE da.id=plan_row.in_attendance_id FOR UPDATE OF da;
        IF NOT FOUND OR incoming_row.dealer_club_id IS DISTINCT FROM v_session.club_id
          OR incoming_row.status IS DISTINCT FROM 'checked_in' OR incoming_row.check_out_time IS NOT NULL
          OR incoming_row.current_state IS DISTINCT FROM 'pre_assigned'
          OR incoming_row.pre_assigned_table_id IS DISTINCT FROM v_session.game_table_id THEN
          RAISE EXCEPTION 'closed_session_announced_identity_invalid';
        END IF;
        IF EXISTS(SELECT 1 FROM public.dealer_assignments other
          WHERE other.id<>plan_row.assignment_id AND other.released_at IS NULL
            AND (other.attendance_id=incoming_row.id OR other.pre_assigned_attendance_id=incoming_row.id))
          OR EXISTS(SELECT 1 FROM public.dealer_rotation_schedule other
            WHERE other.id<>plan_row.id AND other.in_attendance_id=incoming_row.id
              AND other.status IN ('announced','executing')) THEN
          RAISE EXCEPTION 'closed_session_announced_reservation_conflict';
        END IF;
      END IF;
      cancel_result:=public.cancel_rotation_slot(plan_row.id,'table_session_closed');
      IF cancel_result->>'outcome' IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'closed_session_rotation_cancel_failed';
      END IF;
    END LOOP;
    -- Legacy next-dealer reservations have no schedule. Release only the exact
    -- live attendance whose marker and sole active reservation prove ownership.
    FOR legacy_row IN SELECT a.id,a.club_id,a.table_id,a.pre_assigned_attendance_id
      FROM public.dealer_assignments a
      WHERE a.table_session_id=v_session.id AND a.released_at IS NULL
        AND a.pre_assigned_attendance_id IS NOT NULL
      ORDER BY a.id FOR UPDATE OF a
    LOOP
      IF legacy_row.club_id IS DISTINCT FROM v_session.club_id
        OR legacy_row.table_id IS DISTINCT FROM v_session.game_table_id THEN
        RAISE EXCEPTION 'closed_session_legacy_reservation_scope_invalid';
      END IF;
      SELECT da.*,d.club_id AS dealer_club_id INTO incoming_row
      FROM public.dealer_attendance da JOIN public.dealers d ON d.id=da.dealer_id
      WHERE da.id=legacy_row.pre_assigned_attendance_id FOR UPDATE OF da;
      IF NOT FOUND OR incoming_row.dealer_club_id IS DISTINCT FROM v_session.club_id
        OR incoming_row.status IS DISTINCT FROM 'checked_in'
        OR incoming_row.check_out_time IS NOT NULL
        OR incoming_row.current_state IS DISTINCT FROM 'pre_assigned'
        OR incoming_row.pre_assigned_table_id IS DISTINCT FROM v_session.game_table_id THEN
        RAISE EXCEPTION 'closed_session_legacy_reservation_identity_invalid';
      END IF;
      IF EXISTS(SELECT 1 FROM public.dealer_assignments other
        WHERE other.id<>legacy_row.id AND other.released_at IS NULL
          AND (other.attendance_id=incoming_row.id OR other.pre_assigned_attendance_id=incoming_row.id))
        OR EXISTS(SELECT 1 FROM public.dealer_rotation_schedule other
          WHERE other.in_attendance_id=incoming_row.id
            AND other.status IN ('predicted','announced','executing')) THEN
        RAISE EXCEPTION 'closed_session_legacy_reservation_conflict';
      END IF;
      UPDATE public.dealer_assignments SET pre_assigned_attendance_id=NULL,
        pre_assigned_at=NULL,planned_relief_at=NULL WHERE id=legacy_row.id;
      UPDATE public.dealer_attendance SET current_state='available',
        pre_assigned_table_id=NULL,pre_assigned_at=NULL WHERE id=incoming_row.id;
    END LOOP;
  END;
  UPDATE public.dealer_assignments
  SET released_at = COALESCE(released_at, pg_catalog.now()),$patch$;
 corrected:=replace(replace(original,E'\r\n',E'\n'),anchor,replacement);
 IF corrected=replace(original,E'\r\n',E'\n') THEN
  RAISE EXCEPTION 'dealer_close_patch_missing';
 END IF;
 EXECUTE corrected;
 IF position('closed_session_rotation_cancel_failed' IN
   pg_get_functiondef('public.operator_close_club_table_v2(uuid,bigint,uuid)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'dealer_close_postcheck_failed';
 END IF;
END $repair$;
COMMIT;
