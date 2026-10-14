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
  DECLARE plan_row record; cancel_result jsonb;
  BEGIN
    FOR plan_row IN
      SELECT rs.id,rs.club_id,rs.table_id,rs.status
      FROM public.dealer_rotation_schedule rs
      JOIN public.dealer_assignments a ON a.id=rs.assignment_id
      WHERE a.table_session_id=v_session.id
        AND rs.status IN ('predicted','announced','executing')
      ORDER BY rs.id FOR UPDATE OF rs
    LOOP
      IF plan_row.club_id IS DISTINCT FROM v_session.club_id
        OR plan_row.table_id IS DISTINCT FROM v_session.game_table_id THEN
        RAISE EXCEPTION 'closed_session_rotation_scope_invalid';
      END IF;
      IF plan_row.status='executing' THEN
        RAISE EXCEPTION 'closed_session_rotation_executing';
      END IF;
      cancel_result:=public.cancel_rotation_slot(plan_row.id,'table_session_closed');
      IF cancel_result->>'outcome' IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'closed_session_rotation_cancel_failed';
      END IF;
    END LOOP;
    -- Unmatched legacy reservations need their own qualified cleanup. Do not
    -- report a successful close or strand a dealer while that evidence is absent.
    IF EXISTS(SELECT 1 FROM public.dealer_assignments a
      WHERE a.table_session_id=v_session.id AND a.released_at IS NULL
        AND a.pre_assigned_attendance_id IS NOT NULL) THEN
      RAISE EXCEPTION 'closed_session_legacy_reservation_requires_repair';
    END IF;
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
