-- Pending one-table TEST satellite. Creates no practice wallet transactions.
-- The pilot's authoritative entries and starting stack determine the roster.
BEGIN;

CREATE FUNCTION public.provision_online_satellite_table_v1(
  p_pilot_id uuid, p_levels jsonb, p_qualification_slots integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  pilot online_satellite_private.pilots%ROWTYPE;
  gate online_satellite_private.registration_gate%ROWTYPE;
  club_owner uuid;
  bound_table uuid;
  bound_slots integer;
  first_sb bigint;
  first_bb bigint;
  entry_count int;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT p.* INTO pilot FROM online_satellite_private.pilots p WHERE p.id=p_pilot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT owner_id INTO club_owner FROM public.clubs WHERE id=pilot.club_id FOR SHARE;
  SELECT g.* INTO gate FROM online_satellite_private.registration_gate g
    WHERE g.club_id=pilot.club_id AND g.enabled FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  IF actor IS DISTINCT FROM club_owner THEN
    IF actor IS DISTINCT FROM gate.delegated_td_actor_id OR club_owner IS DISTINCT FROM gate.delegated_by THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM public.club_floors WHERE club_id=pilot.club_id AND user_id=actor FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
    END IF;
  END IF;
  PERFORM 1 FROM public.tournaments WHERE id=pilot.destination_tournament_id AND club_id=pilot.club_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_DESTINATION_NOT_IN_CLUB' USING ERRCODE='42501';
  END IF;
  IF pilot.registration_closes_at > pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_REGISTRATION_STILL_OPEN' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(p_levels) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_BAD_LEVELS' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_levels)
      AS l(starts_at_second bigint) WHERE starts_at_second=0)
    OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_levels)
        AS l(starts_at_second bigint, small_blind bigint, big_blind bigint, big_blind_ante bigint)
      WHERE starts_at_second IS NULL OR starts_at_second<0 OR small_blind IS NULL OR small_blind<=0
        OR big_blind IS NULL OR big_blind<=small_blind OR big_blind_ante IS NULL OR big_blind_ante<0
    ) OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_levels) AS l(starts_at_second bigint)
        GROUP BY starts_at_second HAVING count(*)>1) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_BAD_LEVELS' USING ERRCODE='22023';
  END IF;
  SELECT table_id,qualification_slots INTO bound_table,bound_slots
  FROM online_satellite_private.table_clocks WHERE pilot_id=pilot.id;
  IF FOUND THEN
    IF bound_slots IS DISTINCT FROM p_qualification_slots OR (
      SELECT jsonb_agg(to_jsonb(l) ORDER BY starts_at_second) FROM jsonb_to_recordset(p_levels)
        AS l(starts_at_second bigint, small_blind bigint, big_blind bigint, big_blind_ante bigint)
    ) IS DISTINCT FROM (
      SELECT jsonb_agg(to_jsonb(l)-'pilot_id' ORDER BY starts_at_second)
      FROM online_satellite_private.blind_levels l WHERE pilot_id=pilot.id
    ) THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_LEVELS_ALREADY_FIXED' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('tableId',bound_table,'idempotent',true);
  END IF;
  SELECT count(*) INTO entry_count FROM online_satellite_private.entries WHERE pilot_id=pilot.id;
  IF entry_count NOT BETWEEN 2 AND pilot.seat_limit THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_BAD_ROSTER' USING ERRCODE='23514';
  END IF;
  IF p_qualification_slots IS NULL OR p_qualification_slots NOT BETWEEN 1 AND entry_count THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_BAD_QUALIFICATION_SLOTS' USING ERRCODE='22023';
  END IF;
  SELECT small_blind,big_blind INTO first_sb,first_bb FROM jsonb_to_recordset(p_levels)
    AS l(starts_at_second bigint,small_blind bigint,big_blind bigint)
    WHERE starts_at_second=0;
  INSERT INTO public.online_poker_tables(club_id,name,max_seats,sb,bb,min_buyin,max_buyin,starting_stack_default,status)
    VALUES (pilot.club_id,'Satellite TEST',pilot.seat_limit,first_sb,first_bb,0,0,pilot.starting_stack,'paused')
    RETURNING id INTO bound_table;
  INSERT INTO public.online_poker_seats(table_id,seat_no,user_id,stack,status)
    SELECT bound_table,row_number() OVER (ORDER BY registered_at,id),player_user_id,pilot.starting_stack,'sitting'
    FROM online_satellite_private.entries WHERE pilot_id=pilot.id;
  INSERT INTO online_satellite_private.blind_levels
    SELECT pilot.id,l.* FROM jsonb_to_recordset(p_levels)
      AS l(starts_at_second bigint,small_blind bigint,big_blind bigint,big_blind_ante bigint);
  INSERT INTO online_satellite_private.table_clocks(table_id,pilot_id,qualification_slots)
    VALUES (bound_table,pilot.id,p_qualification_slots);
  UPDATE public.online_poker_tables SET is_satellite=true WHERE id=bound_table;
  RETURN jsonb_build_object('tableId',bound_table,'idempotent',false);
END;
$$;

REVOKE ALL ON FUNCTION public.provision_online_satellite_table_v1(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_online_satellite_table_v1(uuid,jsonb,integer) TO authenticated;

COMMIT;
