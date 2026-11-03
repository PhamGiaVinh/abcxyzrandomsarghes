-- Arrival is an acknowledgement only. Never update assignment/attendance,
-- handover timing, payroll or Tracker authority from this endpoint.
BEGIN;

CREATE TABLE floor_private.dealer_table_arrival_ack_v1 (
  assignment_id uuid NOT NULL REFERENCES public.dealer_assignments(id) ON DELETE RESTRICT,
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  attendance_id uuid NOT NULL REFERENCES public.dealer_attendance(id) ON DELETE RESTRICT,
  dealer_id uuid NOT NULL REFERENCES public.dealers(id) ON DELETE RESTRICT,
  acknowledged_by uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatch_at timestamptz NOT NULL,
  incoming boolean NOT NULL,
  handover_at timestamptz,
  PRIMARY KEY (assignment_id, attendance_id, dispatch_at)
);
ALTER TABLE floor_private.dealer_table_arrival_ack_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.dealer_table_arrival_ack_v1 FROM PUBLIC, anon, authenticated, service_role;

-- Capture only the exact planned binding as the canonical writer releases it.
-- Arrival time remains immutable; no scheduler or attendance row is changed.
CREATE FUNCTION floor_private.mark_dealer_arrival_handover_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
    AND NEW.swing_processed_at = NEW.released_at
    AND OLD.pre_assigned_attendance_id IS NOT NULL AND OLD.pre_assigned_at IS NOT NULL THEN
    UPDATE floor_private.dealer_table_arrival_ack_v1
    SET handover_at = NEW.released_at
    WHERE assignment_id = OLD.id AND table_session_id = OLD.table_session_id
      AND attendance_id = OLD.pre_assigned_attendance_id AND dispatch_at = OLD.pre_assigned_at
      AND incoming AND handover_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION floor_private.mark_dealer_arrival_handover_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER dealer_arrival_handover_v1 AFTER UPDATE ON public.dealer_assignments
FOR EACH ROW EXECUTE FUNCTION floor_private.mark_dealer_arrival_handover_v1();

CREATE FUNCTION public.dealer_ack_table_arrival_v1(
  p_assignment_id uuid, p_table_session_id uuid, p_attendance_id uuid, p_dispatch_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_table uuid;
  v_assignment public.dealer_assignments%ROWTYPE;
  v_dealer uuid;
  v_ack floor_private.dealer_table_arrival_ack_v1%ROWTYPE;
  v_incoming boolean;
  v_dispatch_at timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dealer_arrival_unauthorized' USING ERRCODE = '42501';
  END IF;
  -- Match the canonical worker's table -> assignment -> session lock order.
  SELECT a.table_id INTO v_table FROM public.dealer_assignments a WHERE a.id = p_assignment_id;
  PERFORM 1 FROM public.game_tables g WHERE g.id = v_table FOR UPDATE;
  SELECT a.* INTO v_assignment FROM public.dealer_assignments a
  WHERE a.id = p_assignment_id FOR UPDATE;
  IF NOT FOUND OR v_assignment.status <> 'assigned'
    OR v_assignment.released_at IS NOT NULL
    OR v_assignment.table_session_id IS DISTINCT FROM p_table_session_id THEN
    RAISE EXCEPTION 'dealer_arrival_stale_assignment' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.table_sessions s
  WHERE s.id = p_table_session_id AND s.game_table_id = v_assignment.table_id
    AND s.club_id = v_assignment.club_id AND s.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dealer_arrival_stale_session' USING ERRCODE = '55000';
  END IF;
  IF p_attendance_id = v_assignment.attendance_id THEN
    v_incoming := false;
    v_dispatch_at := v_assignment.assigned_at;
  ELSIF p_attendance_id = v_assignment.pre_assigned_attendance_id THEN
    v_incoming := true;
    v_dispatch_at := v_assignment.pre_assigned_at;
  ELSE
    RAISE EXCEPTION 'dealer_arrival_stale_dispatch' USING ERRCODE = '55000';
  END IF;
  IF p_dispatch_at IS NULL OR v_dispatch_at IS DISTINCT FROM p_dispatch_at THEN
    RAISE EXCEPTION 'dealer_arrival_stale_dispatch' USING ERRCODE = '55000';
  END IF;
  SELECT d.id INTO v_dealer
  FROM public.dealer_attendance at JOIN public.dealers d ON d.id = at.dealer_id
  WHERE at.id = p_attendance_id AND at.status = 'checked_in'
    AND at.check_out_time IS NULL AND d.user_id = v_actor
    AND d.club_id = v_assignment.club_id AND d.status = 'active' AND d.deleted_at IS NULL
    AND (v_incoming OR v_assignment.dealer_id IS NULL OR v_assignment.dealer_id = d.id)
    AND (NOT v_incoming OR (at.current_state = 'pre_assigned'
      AND at.pre_assigned_table_id = v_assignment.table_id AND at.pre_assigned_at IS NOT NULL))
  FOR SHARE OF at, d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dealer_arrival_forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO floor_private.dealer_table_arrival_ack_v1
    (assignment_id, table_session_id, attendance_id, dealer_id, acknowledged_by, dispatch_at, incoming)
  VALUES (p_assignment_id, p_table_session_id, p_attendance_id, v_dealer, v_actor, v_dispatch_at, v_incoming)
  ON CONFLICT (assignment_id, attendance_id, dispatch_at) DO NOTHING;
  SELECT * INTO STRICT v_ack FROM floor_private.dealer_table_arrival_ack_v1
  WHERE assignment_id = p_assignment_id AND attendance_id = p_attendance_id AND dispatch_at = v_dispatch_at;
  IF v_ack.table_session_id IS DISTINCT FROM p_table_session_id
    OR v_ack.dealer_id IS DISTINCT FROM v_dealer OR v_ack.acknowledged_by IS DISTINCT FROM v_actor
    OR v_ack.incoming IS DISTINCT FROM v_incoming THEN
    RAISE EXCEPTION 'dealer_arrival_ack_context_conflict' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('assignment_id', v_ack.assignment_id,
    'table_session_id', v_ack.table_session_id, 'attendance_id', v_ack.attendance_id,
    'dispatch_at', v_ack.dispatch_at, 'acknowledged_at', v_ack.acknowledged_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.dealer_ack_table_arrival_v1(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dealer_ack_table_arrival_v1(uuid, uuid, uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.dealer_ack_table_arrival_v1(uuid, uuid, uuid, timestamptz) IS
  'Dealer arrival acknowledgement only; does not change scheduled swing, rest or Tracker control.';

CREATE FUNCTION public.dealer_get_table_arrivals_v1(p_dealer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.dealers d WHERE d.id = p_dealer_id
      AND d.user_id = auth.uid() AND d.deleted_at IS NULL AND d.status = 'active'
  ) THEN
    RAISE EXCEPTION 'dealer_arrival_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'assignment_id', a.id, 'table_session_id', s.id,
      'table_name', g.table_name, 'acknowledged_at', ack.acknowledged_at,
      'attendance_id', dispatch.attendance_id, 'dispatch_at', dispatch.dispatch_at,
      'incoming', dispatch.incoming
    ) ORDER BY a.assigned_at, a.id), '[]'::jsonb)
    FROM public.dealer_assignments a
    CROSS JOIN LATERAL (VALUES
      (a.attendance_id, a.assigned_at, false),
      (a.pre_assigned_attendance_id, a.pre_assigned_at, true)
    ) dispatch(attendance_id, dispatch_at, incoming)
    JOIN public.dealer_attendance at ON at.id = dispatch.attendance_id
    JOIN public.dealers d ON d.id = at.dealer_id
    JOIN public.table_sessions s ON s.id = a.table_session_id
      AND s.game_table_id = a.table_id AND s.club_id = a.club_id AND s.closed_at IS NULL
    JOIN public.game_tables g ON g.id = a.table_id AND g.club_id = a.club_id
    LEFT JOIN LATERAL (
      SELECT recorded.acknowledged_at
      FROM floor_private.dealer_table_arrival_ack_v1 recorded
      WHERE recorded.table_session_id = s.id AND recorded.attendance_id = at.id
        AND recorded.dealer_id = d.id AND recorded.acknowledged_by = auth.uid()
        AND ((recorded.assignment_id = a.id AND recorded.dispatch_at = dispatch.dispatch_at
          AND recorded.incoming = dispatch.incoming)
        OR (NOT dispatch.incoming AND recorded.incoming
          AND recorded.handover_at = a.assigned_at AND EXISTS (
          -- Explicit canonical handover receipt; never infer continuity from
          -- elapsed time, same table or dealer name.
          SELECT 1 FROM public.swing_log log
          WHERE log.assignment_id = recorded.assignment_id AND log.club_id = a.club_id
            AND log.table_id = a.table_id AND log.outcome = 'swung'
            AND log.metadata->>'type' = 'pre_assigned_swing'
            AND log.metadata->>'new_assignment_id' = a.id::text
            AND log.metadata->>'incoming_attendance_id' = at.id::text
        )))
      ORDER BY recorded.acknowledged_at LIMIT 1
    ) ack ON true
    WHERE d.id = p_dealer_id AND d.user_id = auth.uid() AND d.club_id = a.club_id
      AND at.status = 'checked_in' AND at.check_out_time IS NULL
      AND a.status = 'assigned' AND a.released_at IS NULL
      AND dispatch.dispatch_at IS NOT NULL
      AND (dispatch.incoming OR a.dealer_id IS NULL OR a.dealer_id = d.id)
      AND (NOT dispatch.incoming OR (at.current_state = 'pre_assigned'
        AND at.pre_assigned_table_id = a.table_id AND at.pre_assigned_at IS NOT NULL))
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.dealer_get_table_arrivals_v1(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dealer_get_table_arrivals_v1(uuid) TO authenticated;
COMMIT;
