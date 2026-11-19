-- Pending. Preserve the observed practice reaper and exclude bound Satellite seats.
-- Rollback of the old body is only safe before any Satellite table exists.
BEGIN;
DO $check$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=
      to_regprocedure('public.op_reap_stale_seats(integer)'))
      IS DISTINCT FROM '821b7348369ef1fac2045eed7dbfcf9e' THEN
    RAISE EXCEPTION 'unexpected practice reaper source';
  END IF;
END;
$check$;

CREATE OR REPLACE FUNCTION public.op_reap_stale_seats(p_stale_secs int DEFAULT 45)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reaped   int := 0;
  v_seat     record;
  v_host     uuid;
  v_new_host uuid;
BEGIN
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled', 'reaped', 0);
  END IF;
  -- Floor the window so a misconfig can never reap fresh seats.
  IF p_stale_secs IS NULL OR p_stale_secs < 15 THEN p_stale_secs := 15; END IF;

  FOR v_seat IN
    SELECT s.id, s.table_id, s.seat_no, s.user_id
    FROM public.online_poker_seats s
    WHERE s.status IN ('sitting', 'sitting_out')
      AND s.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM online_satellite_private.table_clocks c WHERE c.table_id = s.table_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.online_poker_tables t WHERE t.id=s.table_id AND t.is_satellite
      )
      AND s.last_seen_at < now() - make_interval(secs => p_stale_secs)
      -- sit-race guard: a freshly (re)claimed seat keeps a fresh joined_at even if its
      -- last_seen_at is old, so require BOTH to be stale.
      AND s.joined_at    < now() - make_interval(secs => p_stale_secs)
      -- not contesting a live hand (those are force-folded by the timeout-sweep)
      AND NOT EXISTS (
        SELECT 1 FROM public.online_poker_hands h
        JOIN public.online_poker_hand_seats hs ON hs.hand_id = h.id
        WHERE h.table_id = s.table_id AND h.status IN ('dealing', 'betting')
          AND hs.seat_no = s.seat_no AND hs.status IN ('active', 'allin')
      )
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    UPDATE public.online_poker_seats
    SET user_id = NULL, stack = 0, status = 'empty'
    WHERE id = v_seat.id;
    v_reaped := v_reaped + 1;

    -- Reassign the host if we just removed this table's host.
    SELECT host_user_id INTO v_host FROM public.online_poker_tables
    WHERE id = v_seat.table_id FOR UPDATE;
    IF v_host = v_seat.user_id THEN
      SELECT user_id INTO v_new_host FROM public.online_poker_seats
      WHERE table_id = v_seat.table_id AND user_id IS NOT NULL AND status IN ('sitting', 'sitting_out')
      ORDER BY seat_no ASC LIMIT 1;
      UPDATE public.online_poker_tables SET host_user_id = v_new_host WHERE id = v_seat.table_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('outcome', 'ok', 'reaped', v_reaped);
END;
$$;

COMMIT;
