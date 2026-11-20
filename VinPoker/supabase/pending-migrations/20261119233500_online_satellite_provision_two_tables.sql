-- G04: create an initial balanced pair using registered entries only.
BEGIN;
CREATE FUNCTION public.provision_online_satellite_two_tables_v1(
  p_pilot_id uuid, p_levels jsonb, p_qualification_slots integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  anchor uuid;
  secondary uuid;
  anchor_row public.online_poker_tables%ROWTYPE;
  seat_count integer;
  next_seat integer := 0;
  source_seat record;
  receipt jsonb;
BEGIN
  PERFORM 1 FROM online_satellite_private.pilots WHERE id=p_pilot_id FOR UPDATE;
  SELECT (public.provision_online_satellite_table_v1(
    p_pilot_id,p_levels,p_qualification_slots)->>'tableId')::uuid INTO anchor;
  SELECT m.table_id INTO secondary FROM online_satellite_private.round_tables m
    WHERE m.pilot_id=p_pilot_id AND m.table_id<>anchor;
  IF FOUND THEN
    RETURN jsonb_build_object('tableIds',jsonb_build_array(anchor,secondary),'idempotent',true);
  END IF;
  IF EXISTS (SELECT 1 FROM online_satellite_private.round_tables WHERE pilot_id=p_pilot_id) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_INCOMPLETE_ROUND_MEMBERSHIP' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.online_poker_seats WHERE table_id=anchor ORDER BY seat_no FOR UPDATE;
  SELECT * INTO STRICT anchor_row FROM public.online_poker_tables WHERE id=anchor FOR UPDATE;
  IF anchor_row.status <> 'paused' OR EXISTS (
    SELECT 1 FROM public.online_poker_hands WHERE table_id=anchor
  ) OR EXISTS (
    SELECT 1 FROM online_satellite_private.locked_results WHERE pilot_id=p_pilot_id
  ) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_ALREADY_STARTED' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO seat_count FROM public.online_poker_seats
    WHERE table_id=anchor AND user_id IS NOT NULL AND stack>0 AND status='sitting';
  IF seat_count < 4 OR p_qualification_slots >= seat_count THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_TWO_TABLES_BAD_ROSTER' USING ERRCODE='23514';
  END IF;

  -- The shared clock is initially stopped; the secondary is eligible to
  -- receive deals only once the clock and round permit both authorize them.
  INSERT INTO public.online_poker_tables(
    club_id,name,max_seats,sb,bb,min_buyin,max_buyin,starting_stack_default,status,is_satellite
  ) VALUES (anchor_row.club_id,'Satellite TEST · Bàn 2',anchor_row.max_seats,
    anchor_row.sb,anchor_row.bb,0,0,anchor_row.starting_stack_default,'open',true)
  RETURNING id INTO secondary;
  INSERT INTO online_satellite_private.round_tables(table_id,pilot_id)
    VALUES (anchor,p_pilot_id),(secondary,p_pilot_id);

  FOR source_seat IN
    SELECT id FROM public.online_poker_seats WHERE table_id=anchor
      AND user_id IS NOT NULL AND stack>0 AND status='sitting' ORDER BY seat_no DESC LIMIT seat_count/2
  LOOP
    next_seat := next_seat+1;
    receipt := public.move_online_satellite_round_seat_v2(p_pilot_id,source_seat.id,secondary,next_seat,0,0);
    IF receipt->>'outcome' IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_INITIAL_MOVE_FAILED' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN jsonb_build_object('tableIds',jsonb_build_array(anchor,secondary),'idempotent',false);
END;
$$;
REVOKE ALL ON FUNCTION public.provision_online_satellite_two_tables_v1(uuid,jsonb,integer)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.provision_online_satellite_two_tables_v1(uuid,jsonb,integer) TO authenticated;
COMMIT;
