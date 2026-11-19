-- Source-only registration for the one-table online Satellite pilot.
-- Chip stacks and tickets in this contract have no monetary value.
-- Rollback: remove pilot UI entrypoints and revoke RPC execution; retain evidence.
BEGIN;

CREATE SCHEMA IF NOT EXISTS online_satellite_private;
REVOKE ALL ON SCHEMA online_satellite_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS online_satellite_private.registration_gate (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id),
  enabled boolean NOT NULL DEFAULT false,
  delegated_td_actor_id uuid REFERENCES auth.users(id),
  delegated_by uuid REFERENCES auth.users(id),
  CHECK ((delegated_td_actor_id IS NULL) = (delegated_by IS NULL))
);
CREATE TABLE IF NOT EXISTS online_satellite_private.pilots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  destination_tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL,
  registration_closes_at timestamptz NOT NULL,
  starting_stack integer NOT NULL CHECK (starting_stack > 0),
  seat_limit integer NOT NULL CHECK (seat_limit BETWEEN 2 AND 9),
  UNIQUE (club_id, request_id)
);
CREATE TABLE IF NOT EXISTS online_satellite_private.entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id uuid NOT NULL REFERENCES online_satellite_private.pilots(id),
  player_user_id uuid NOT NULL REFERENCES auth.users(id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pilot_id, player_user_id)
);
ALTER TABLE online_satellite_private.pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_satellite_private.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_satellite_private.registration_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA online_satellite_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_online_satellite_pilot_v1(
  p_club_id uuid, p_destination_tournament_id uuid, p_request_id uuid,
  p_registration_closes_at timestamptz, p_starting_stack integer, p_seat_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_gate online_satellite_private.registration_gate%ROWTYPE;
  v_pilot online_satellite_private.pilots%ROWTYPE;
BEGIN
  SELECT c.owner_id INTO v_owner FROM public.clubs c WHERE c.id=p_club_id FOR UPDATE;
  IF v_actor IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT g.* INTO v_gate FROM online_satellite_private.registration_gate g
    WHERE g.club_id=p_club_id AND g.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
  IF v_owner IS DISTINCT FROM v_actor THEN
    IF v_gate.delegated_td_actor_id IS DISTINCT FROM v_actor
      OR v_gate.delegated_by IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM public.club_floors f WHERE f.club_id=p_club_id AND f.user_id=v_actor FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_request_id IS NULL OR p_registration_closes_at IS NULL
    OR NOT pg_catalog.isfinite(p_registration_closes_at)
    OR p_starting_stack IS NULL OR p_starting_stack <= 0
    OR p_seat_limit IS NULL OR p_seat_limit NOT BETWEEN 2 AND 9 THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_BAD_CONFIGURATION' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.tournaments t
    WHERE t.id=p_destination_tournament_id AND t.club_id=p_club_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_DESTINATION_NOT_IN_CLUB' USING ERRCODE='42501';
  END IF;
  SELECT p.* INTO v_pilot FROM online_satellite_private.pilots p
    WHERE p.club_id=p_club_id AND p.request_id=p_request_id;
  IF FOUND THEN
    IF v_pilot.created_by IS DISTINCT FROM v_actor
      OR v_pilot.destination_tournament_id IS DISTINCT FROM p_destination_tournament_id
      OR v_pilot.registration_closes_at IS DISTINCT FROM p_registration_closes_at
      OR v_pilot.starting_stack IS DISTINCT FROM p_starting_stack
      OR v_pilot.seat_limit IS DISTINCT FROM p_seat_limit THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_REQUEST_CONFLICT' USING ERRCODE='23505';
    END IF;
  ELSE
    IF p_registration_closes_at <= pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_BAD_CONFIGURATION' USING ERRCODE='22023';
    END IF;
    INSERT INTO online_satellite_private.pilots (
      club_id, destination_tournament_id, created_by, request_id,
      registration_closes_at, starting_stack, seat_limit
    ) VALUES (
      p_club_id, p_destination_tournament_id, v_actor, p_request_id,
      p_registration_closes_at, p_starting_stack, p_seat_limit
    ) RETURNING * INTO v_pilot;
  END IF;
  RETURN pg_catalog.jsonb_build_object('pilotId',v_pilot.id,'registrationClosesAt',v_pilot.registration_closes_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_online_satellite_pilot_v1(p_pilot_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_pilot online_satellite_private.pilots%ROWTYPE;
  v_entry_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
  SELECT p.* INTO v_pilot FROM online_satellite_private.pilots p WHERE p.id=p_pilot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.club_members m
    WHERE m.club_id=v_pilot.club_id AND m.player_user_id=v_actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tournaments t
    WHERE t.id=v_pilot.destination_tournament_id AND t.club_id=v_pilot.club_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
  SELECT e.id INTO v_entry_id FROM online_satellite_private.entries e
    WHERE e.pilot_id=v_pilot.id AND e.player_user_id=v_actor;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('entryId',v_entry_id,'idempotent',true);
  END IF;
  PERFORM 1 FROM online_satellite_private.registration_gate g WHERE g.club_id=v_pilot.club_id AND g.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
  IF v_pilot.registration_closes_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_REGISTRATION_CLOSED' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM online_satellite_private.entries e WHERE e.pilot_id=v_pilot.id) >= v_pilot.seat_limit THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_FULL' USING ERRCODE='23514';
  END IF;
  INSERT INTO online_satellite_private.entries(pilot_id,player_user_id) VALUES (v_pilot.id,v_actor)
    RETURNING id INTO v_entry_id;
  RETURN pg_catalog.jsonb_build_object('entryId',v_entry_id,'idempotent',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_online_satellite_pilot_v1(p_pilot_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  SELECT pg_catalog.jsonb_build_object(
    'pilotId',p.id,'destinationName',t.name,'registrationClosesAt',p.registration_closes_at,
    'startingStack',p.starting_stack,'seatLimit',p.seat_limit,
    'entryId',(SELECT e.id FROM online_satellite_private.entries e
      WHERE e.pilot_id=p.id AND e.player_user_id=v_actor),
    'acceptingEntries',coalesce(g.enabled,false) AND p.registration_closes_at > pg_catalog.statement_timestamp()
      AND (SELECT count(*) FROM online_satellite_private.entries e WHERE e.pilot_id=p.id) < p.seat_limit
  ) INTO v_result
  FROM online_satellite_private.pilots p
  JOIN public.tournaments t ON t.id=p.destination_tournament_id AND t.club_id=p.club_id
  LEFT JOIN online_satellite_private.registration_gate g ON g.club_id=p.club_id
  WHERE p.id=p_pilot_id AND v_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.club_members m WHERE m.club_id=p.club_id AND m.player_user_id=v_actor
  );
  IF v_result IS NULL THEN RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_online_satellite_pilot_v1(uuid,uuid,uuid,timestamptz,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_online_satellite_pilot_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_online_satellite_pilot_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_online_satellite_pilot_v1(uuid,uuid,uuid,timestamptz,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_online_satellite_pilot_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_online_satellite_pilot_v1(uuid) TO authenticated;
COMMIT;
