-- Pending: protect all six existing public poker reads for bound Satellite tables.
-- The binding must be created atomically with the table and kept through retention.
BEGIN;

CREATE FUNCTION online_satellite_private.can_read_poker_table(p_table_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (NOT EXISTS (
    SELECT 1 FROM public.online_poker_tables t WHERE t.id=p_table_id AND t.is_satellite
  ) OR EXISTS (
    SELECT 1 FROM online_satellite_private.table_clocks c WHERE c.table_id=p_table_id
  )) AND NOT EXISTS (
    SELECT 1 FROM online_satellite_private.table_clocks c
    WHERE c.table_id = p_table_id AND NOT EXISTS (
      SELECT 1 FROM online_satellite_private.entries e
      WHERE e.pilot_id = c.pilot_id AND e.player_user_id = (SELECT auth.uid())
    )
  );
$$;

REVOKE ALL ON FUNCTION online_satellite_private.can_read_poker_table(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION online_satellite_private.can_read_poker_table(uuid) TO anon, authenticated;

CREATE POLICY op_satellite_table_scope ON public.online_poker_tables
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (online_satellite_private.can_read_poker_table(id));
CREATE POLICY op_satellite_seat_scope ON public.online_poker_seats
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (online_satellite_private.can_read_poker_table(table_id));
CREATE POLICY op_satellite_hand_scope ON public.online_poker_hands
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (online_satellite_private.can_read_poker_table(table_id));

-- Parent hand lookup applies its own SELECT policies to the caller.
CREATE POLICY op_satellite_hand_seat_scope ON public.online_poker_hand_seats
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.online_poker_hands h WHERE h.id = hand_id));
CREATE POLICY op_satellite_event_scope ON public.online_poker_hand_events
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.online_poker_hands h WHERE h.id = hand_id));
CREATE POLICY op_satellite_snapshot_scope ON public.online_poker_hand_snapshots
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.online_poker_hands h WHERE h.id = hand_id));

-- Realtime DELETE records may bypass SELECT policies. Retain pilot history;
-- a future retention path must account for the publication before deleting.
CREATE FUNCTION online_satellite_private.retain_pilot_hand()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  source_table uuid;
BEGIN
  IF TG_TABLE_NAME = 'online_poker_hands' THEN
    source_table := OLD.table_id;
  ELSE
    SELECT h.table_id INTO source_table FROM public.online_poker_hands h WHERE h.id=OLD.hand_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.online_poker_tables t WHERE t.id=source_table AND t.is_satellite)
    OR EXISTS (SELECT 1 FROM online_satellite_private.table_clocks c WHERE c.table_id=source_table) THEN
    RAISE EXCEPTION 'online_satellite_hand_history_is_retained' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION online_satellite_private.retain_pilot_hand() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_retain_satellite_hand BEFORE DELETE ON public.online_poker_hands
  FOR EACH ROW EXECUTE FUNCTION online_satellite_private.retain_pilot_hand();
CREATE TRIGGER trg_retain_satellite_hand_seat BEFORE DELETE ON public.online_poker_hand_seats
  FOR EACH ROW EXECUTE FUNCTION online_satellite_private.retain_pilot_hand();

COMMIT;
