-- Pending G04. Internal hand-for-hand fence. Single-table pilots have no round
-- membership. Keep the G04 provisioning path disabled until the controller,
-- move and result writers share the same persisted membership.
BEGIN;

CREATE TABLE online_satellite_private.round_tables (
  table_id uuid PRIMARY KEY REFERENCES public.online_poker_tables(id),
  pilot_id uuid NOT NULL REFERENCES online_satellite_private.pilots(id),
  UNIQUE (pilot_id, table_id)
);
CREATE TABLE online_satellite_private.round_deals (
  pilot_id uuid NOT NULL,
  round_no bigint NOT NULL CHECK (round_no > 0),
  table_id uuid NOT NULL,
  hand_id uuid UNIQUE REFERENCES public.online_poker_hands(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (pilot_id, round_no, table_id),
  FOREIGN KEY (pilot_id, table_id) REFERENCES online_satellite_private.round_tables(pilot_id, table_id)
);
ALTER TABLE online_satellite_private.round_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_satellite_private.round_deals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON online_satellite_private.round_tables, online_satellite_private.round_deals
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION online_satellite_private.consume_round_deal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  member_pilot uuid;
  expected_round text := NEW.state->>'satelliteRound';
BEGIN
  SELECT pilot_id INTO member_pilot FROM online_satellite_private.round_tables
    WHERE table_id = NEW.table_id;
  IF NOT FOUND THEN
    IF expected_round IS NOT NULL THEN
      RAISE EXCEPTION 'online_satellite_round_membership_missing' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- One permit for this table, in the latest round of this pilot. Claiming it
  -- and writing the hand are one transaction, including on rollback.
  UPDATE online_satellite_private.round_deals AS permit
    SET hand_id = NEW.id
    WHERE permit.pilot_id = member_pilot AND permit.table_id = NEW.table_id
      AND permit.round_no = (
        SELECT max(r.round_no) FROM online_satellite_private.round_deals AS r
          WHERE r.pilot_id = member_pilot
      )
      AND permit.round_no::text = expected_round
      AND permit.hand_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'online_satellite_round_deal_not_available' USING ERRCODE = '23514';
  END IF;
  NEW.state := NEW.state - 'satelliteRound';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION online_satellite_private.consume_round_deal()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_op_consume_satellite_round_deal
  BEFORE INSERT ON public.online_poker_hands
  FOR EACH ROW EXECUTE FUNCTION online_satellite_private.consume_round_deal();

CREATE FUNCTION online_satellite_private.open_next_round(p_pilot_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  latest_round bigint;
BEGIN
  -- All round controllers serialize here. No seat or hand lock is taken
  -- here, so an in-flight deal or settlement can finish independently.
  PERFORM 1 FROM online_satellite_private.pilots WHERE id = p_pilot_id FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM online_satellite_private.round_tables
    WHERE pilot_id = p_pilot_id) < 2 THEN
    RAISE EXCEPTION 'online_satellite_round_requires_multiple_tables' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM online_satellite_private.round_tables m
    JOIN online_satellite_private.pilots p ON p.id = m.pilot_id
    JOIN public.online_poker_tables t ON t.id = m.table_id
    WHERE m.pilot_id = p_pilot_id
      AND (NOT t.is_satellite OR t.club_id IS DISTINCT FROM p.club_id OR t.status <> 'open')
  ) THEN
    RAISE EXCEPTION 'online_satellite_round_invalid_table' USING ERRCODE = '23514';
  END IF;

  SELECT max(round_no) INTO latest_round FROM online_satellite_private.round_deals
    WHERE pilot_id = p_pilot_id;
  IF EXISTS (
    SELECT 1 FROM online_satellite_private.round_deals d
    LEFT JOIN public.online_poker_hands h ON h.id = d.hand_id
    WHERE d.pilot_id = p_pilot_id AND d.round_no = latest_round
      AND h.status IS DISTINCT FROM 'complete'
  ) THEN
    RAISE EXCEPTION 'online_satellite_round_still_playing' USING ERRCODE = '23514';
  END IF;

  latest_round := coalesce(latest_round, 0) + 1;
  INSERT INTO online_satellite_private.round_deals(pilot_id, round_no, table_id)
    SELECT pilot_id, latest_round, table_id FROM online_satellite_private.round_tables
      WHERE pilot_id = p_pilot_id;
  RETURN latest_round;
END;
$$;
REVOKE ALL ON FUNCTION online_satellite_private.open_next_round(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
