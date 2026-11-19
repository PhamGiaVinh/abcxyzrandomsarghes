-- G04: move one registered seat without touching chip balances.
BEGIN;

CREATE TABLE online_satellite_private.round_seat_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id bigint NOT NULL,
  pilot_id uuid NOT NULL REFERENCES online_satellite_private.pilots(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  seat_id uuid NOT NULL,
  from_table uuid NOT NULL,
  from_seat int NOT NULL,
  to_table uuid NOT NULL,
  to_seat int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE online_satellite_private.round_seat_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON online_satellite_private.round_seat_moves FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.op_guard_satellite_seat()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  source_bound boolean := false;
  target_bound boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT EXISTS (SELECT 1 FROM online_satellite_private.table_clocks WHERE table_id=OLD.table_id)
      OR EXISTS (SELECT 1 FROM public.online_poker_tables WHERE id=OLD.table_id AND is_satellite)
    INTO source_bound;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT EXISTS (SELECT 1 FROM online_satellite_private.table_clocks WHERE table_id=NEW.table_id)
      OR EXISTS (SELECT 1 FROM public.online_poker_tables WHERE id=NEW.table_id AND is_satellite)
    INTO target_bound;
  END IF;
  IF source_bound OR target_bound THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'online_satellite_roster_is_fixed' USING ERRCODE='23514';
    END IF;
    IF OLD.table_id IS DISTINCT FROM NEW.table_id OR OLD.seat_no IS DISTINCT FROM NEW.seat_no
       OR OLD.user_id IS DISTINCT FROM NEW.user_id OR (OLD.stack = 0 AND NEW.stack > 0) THEN
      IF OLD.user_id IS NOT NULL AND OLD.stack > 0 AND OLD.stack = NEW.stack
        AND OLD.user_id = NEW.user_id AND OLD.status = NEW.status AND OLD.id = NEW.id
        AND EXISTS (SELECT 1 FROM online_satellite_private.round_seat_moves m
          WHERE m.transaction_id=txid_current() AND m.seat_id=OLD.id
            AND m.from_table=OLD.table_id AND m.from_seat=OLD.seat_no
            AND m.to_table=NEW.table_id AND m.to_seat=NEW.seat_no) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'online_satellite_roster_is_fixed' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.move_online_satellite_round_seat_v1(
  p_pilot_id uuid, p_seat_id uuid, p_destination uuid, p_destination_seat int, p_expected_round bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  anchor_table uuid;
  latest bigint;
  source_seat public.online_poker_seats%ROWTYPE;
  destination public.online_poker_tables%ROWTYPE;
BEGIN
  PERFORM 1 FROM online_satellite_private.pilots WHERE id=p_pilot_id FOR UPDATE;
  SELECT table_id INTO anchor_table FROM online_satellite_private.table_clocks WHERE pilot_id=p_pilot_id;
  IF NOT FOUND OR actor IS NULL OR NOT public.op_lock_satellite_manual_dealer(anchor_table,actor) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(max(round_no),0) INTO latest FROM online_satellite_private.round_deals WHERE pilot_id=p_pilot_id;
  IF p_expected_round IS DISTINCT FROM latest THEN
    RETURN jsonb_build_object('outcome','stale','roundNo',latest::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM online_satellite_private.round_deals d
    LEFT JOIN public.online_poker_hands h ON h.id=d.hand_id
    WHERE d.pilot_id=p_pilot_id AND d.round_no=latest AND h.status IS DISTINCT FROM 'complete'
  ) OR EXISTS (
    SELECT 1 FROM online_satellite_private.round_tables m
    JOIN public.online_poker_hands h ON h.table_id=m.table_id
    WHERE m.pilot_id=p_pilot_id AND h.status IN ('dealing','betting')
  ) THEN
    RETURN jsonb_build_object('outcome','round_still_playing');
  END IF;
  SELECT s.* INTO source_seat FROM public.online_poker_seats s
    JOIN online_satellite_private.round_tables m ON m.table_id=s.table_id AND m.pilot_id=p_pilot_id
    JOIN online_satellite_private.entries e ON e.pilot_id=m.pilot_id AND e.player_user_id=s.user_id
    JOIN online_satellite_private.pilots p ON p.id=m.pilot_id
    JOIN public.online_poker_tables t ON t.id=s.table_id AND t.club_id=p.club_id AND t.is_satellite
      AND t.status IN ('open','paused')
    WHERE s.id=p_seat_id AND s.stack>0 AND s.status='sitting' FOR UPDATE OF s;
  SELECT t.* INTO destination FROM public.online_poker_tables t
    JOIN online_satellite_private.round_tables m ON m.table_id=t.id AND m.pilot_id=p_pilot_id
    JOIN online_satellite_private.pilots p ON p.id=m.pilot_id AND p.club_id=t.club_id
    WHERE t.id=p_destination AND t.is_satellite AND t.status IN ('open','paused') FOR SHARE OF t;
  IF source_seat.id IS NULL OR destination.id IS NULL OR source_seat.table_id=destination.id
    OR p_destination_seat IS NULL OR p_destination_seat NOT BETWEEN 1 AND destination.max_seats
    OR EXISTS (SELECT 1 FROM public.online_poker_seats WHERE table_id=p_destination
      AND (seat_no=p_destination_seat OR user_id=source_seat.user_id)) THEN
    RETURN jsonb_build_object('outcome','invalid_destination');
  END IF;
  INSERT INTO online_satellite_private.round_seat_moves(
    transaction_id,pilot_id,actor_id,seat_id,from_table,from_seat,to_table,to_seat)
    VALUES (txid_current(),p_pilot_id,actor,source_seat.id,source_seat.table_id,source_seat.seat_no,
      p_destination,p_destination_seat);
  UPDATE public.online_poker_seats SET table_id=p_destination,seat_no=p_destination_seat
    WHERE id=source_seat.id;
  RETURN jsonb_build_object('outcome','ok','tableId',p_destination,'seatNo',p_destination_seat);
END;
$$;
REVOKE ALL ON FUNCTION public.move_online_satellite_round_seat_v1(uuid,uuid,uuid,int,bigint)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.move_online_satellite_round_seat_v1(uuid,uuid,uuid,int,bigint)
  TO authenticated;
COMMIT;
