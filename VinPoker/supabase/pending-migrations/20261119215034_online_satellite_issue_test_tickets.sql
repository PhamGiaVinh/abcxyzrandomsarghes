-- Pending non-financial pilot tickets. Only explicitly designated TEST targets
-- can be used. No rows are seeded in that allowlist by this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS online_satellite_private.test_destinations (
  tournament_id uuid PRIMARY KEY REFERENCES public.tournaments(id),
  club_id uuid NOT NULL REFERENCES public.clubs(id)
);
CREATE TABLE IF NOT EXISTS online_satellite_private.test_ticket_batches (
  pilot_id uuid PRIMARY KEY REFERENCES online_satellite_private.locked_results(pilot_id),
  destination_id uuid NOT NULL REFERENCES online_satellite_private.test_destinations(tournament_id),
  request_id uuid NOT NULL UNIQUE,
  issued_by uuid NOT NULL REFERENCES auth.users(id),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  CHECK (expires_at > issued_at)
);
CREATE TABLE IF NOT EXISTS online_satellite_private.test_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id uuid NOT NULL REFERENCES online_satellite_private.test_ticket_batches(pilot_id),
  entry_id uuid NOT NULL UNIQUE REFERENCES online_satellite_private.entries(id)
);
ALTER TABLE online_satellite_private.test_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_satellite_private.test_ticket_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_satellite_private.test_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON online_satellite_private.test_destinations, online_satellite_private.test_ticket_batches,
  online_satellite_private.test_tickets FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.issue_online_satellite_test_tickets_v1(
  p_pilot_id uuid, p_request_id uuid, p_expires_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  bound_table uuid;
  pilot online_satellite_private.pilots%ROWTYPE;
  locked online_satellite_private.locked_results%ROWTYPE;
  batch online_satellite_private.test_ticket_batches%ROWTYPE;
  ticket_count integer;
BEGIN
  IF p_request_id IS NULL OR p_expires_at IS NULL OR NOT isfinite(p_expires_at) THEN
    RAISE EXCEPTION 'SATELLITE_TEST_ISSUE_BAD_REQUEST' USING ERRCODE='22023';
  END IF;
  SELECT * INTO pilot FROM online_satellite_private.pilots WHERE id=p_pilot_id;
  SELECT table_id INTO bound_table FROM online_satellite_private.table_clocks WHERE pilot_id=p_pilot_id;
  IF actor IS NULL OR NOT FOUND OR NOT public.op_lock_satellite_manual_dealer(bound_table,actor) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.tournaments t
    JOIN online_satellite_private.test_destinations d ON d.tournament_id=t.id AND d.club_id=t.club_id
    WHERE t.id=pilot.destination_tournament_id AND t.club_id=pilot.club_id FOR SHARE OF t,d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SATELLITE_TEST_DESTINATION_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO locked FROM online_satellite_private.locked_results WHERE pilot_id=p_pilot_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_ready'); END IF;
  SELECT * INTO batch FROM online_satellite_private.test_ticket_batches WHERE pilot_id=p_pilot_id;
  IF FOUND THEN
    IF batch.request_id IS DISTINCT FROM p_request_id OR batch.issued_by IS DISTINCT FROM actor
      OR batch.expires_at IS DISTINCT FROM p_expires_at THEN
      RAISE EXCEPTION 'SATELLITE_TEST_ISSUE_CONFLICT' USING ERRCODE='23505';
    END IF;
    SELECT count(*) INTO ticket_count FROM online_satellite_private.test_tickets WHERE pilot_id=p_pilot_id;
    RETURN jsonb_build_object('outcome','ok','idempotent',true,'ticketCount',ticket_count);
  END IF;
  IF p_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'SATELLITE_TEST_ISSUE_BAD_EXPIRY' USING ERRCODE='22023';
  END IF;
  INSERT INTO online_satellite_private.test_ticket_batches(pilot_id,destination_id,request_id,issued_by,expires_at)
    VALUES (p_pilot_id,pilot.destination_tournament_id,p_request_id,actor,p_expires_at);
  INSERT INTO online_satellite_private.test_tickets(pilot_id,entry_id)
    SELECT p_pilot_id,e.id FROM online_satellite_private.entries e
    WHERE e.pilot_id=p_pilot_id AND e.id=ANY(locked.qualified_entries);
  GET DIAGNOSTICS ticket_count = ROW_COUNT;
  IF ticket_count IS DISTINCT FROM locked.qualification_slots THEN
    RAISE EXCEPTION 'SATELLITE_TEST_ISSUE_INCOMPLETE_ROSTER' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('outcome','ok','idempotent',false,'ticketCount',ticket_count);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_online_satellite_test_tickets_v1(uuid,uuid,timestamptz)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.issue_online_satellite_test_tickets_v1(uuid,uuid,timestamptz) TO authenticated;

COMMIT;
