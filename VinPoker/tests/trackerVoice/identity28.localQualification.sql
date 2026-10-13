-- Local dependency qualification only: exact deployed reviewed identity28 lineage.
-- No historical migration edits, no production writes, no ledger receipts.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'vinpoker_voice_release71_20261014' OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres' OR EXISTS(SELECT 1 FROM public.clubs) THEN RAISE EXCEPTION 'owned_empty_qualification_db_required'; END IF;
 IF md5(replace(pg_get_functiondef('floor_private.snapshot_tracker_hand_blinds()'::regprocedure),chr(13),''))<>'c101c4e790be82bc8af9f3ff9539a92e' THEN RAISE EXCEPTION 'local_dependency_drift'; END IF;
 IF md5(replace(pg_get_functiondef('start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamp with time zone,uuid,integer)'::regprocedure),chr(13),''))<>'3e8a17200f840d53c1fc52e750bc7de8' THEN RAISE EXCEPTION 'local_dependency_drift'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION floor_private.snapshot_tracker_hand_blinds()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tour record;
  v_session record;
  v_level record;
  v_seats integer[];
  v_count integer;
  v_prior record;
  v_prior_sb integer;
  v_prior_bb integer;
  v_sb integer;
  v_bb integer;
BEGIN
  IF NEW.table_session_id IS NULL THEN RETURN NEW; END IF;

  SELECT control_mode, closed_at INTO v_session
  FROM public.table_sessions
  WHERE id = NEW.table_session_id
    AND tournament_id = NEW.tournament_id;
  IF NOT FOUND OR v_session.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'tracker_table_session_unavailable';
  END IF;
  IF v_session.control_mode IS DISTINCT FROM 'tracker' THEN RETURN NEW; END IF;

  SELECT current_level_id, current_level INTO v_tour
  FROM public.tournaments WHERE id = NEW.tournament_id;
  SELECT id, level_number, small_blind, big_blind, ante, is_break INTO v_level
  FROM public.tournament_levels
  WHERE tournament_id = NEW.tournament_id
    AND ((v_tour.current_level_id IS NOT NULL AND id = v_tour.current_level_id)
      OR (v_tour.current_level_id IS NULL AND level_number = v_tour.current_level))
  LIMIT 1;
  IF NOT FOUND OR COALESCE(v_level.is_break, true)
    OR v_level.small_blind IS NULL OR v_level.small_blind <= 0
    OR v_level.big_blind IS NULL OR v_level.big_blind < v_level.small_blind
    OR v_level.ante IS NULL OR v_level.ante < 0 THEN
    RAISE EXCEPTION 'tracker_floor_blind_level_unavailable';
  END IF;
  NEW.tracker_level_id := v_level.id;
  NEW.tracker_level_number := v_level.level_number;
  NEW.tracker_small_blind := v_level.small_blind;
  NEW.tracker_big_blind := v_level.big_blind;
  NEW.tracker_bba := v_level.ante;
  NEW.tracker_is_break := false;

  SELECT array_agg(seat_number ORDER BY seat_number), count(*)::integer
    INTO v_seats, v_count
  FROM public.tournament_seats
  WHERE tournament_id = NEW.tournament_id
    AND table_session_id = NEW.table_session_id
    AND tournament_table_id = (
      SELECT tt.id FROM public.tournament_tables tt
      WHERE tt.tournament_id = NEW.tournament_id
        AND tt.table_session_id = NEW.table_session_id
        AND tt.status = 'active'
        AND (NEW.tournament_table_id IS NULL OR tt.id = NEW.tournament_table_id)
        AND (tt.id = NEW.table_id OR tt.game_table_id = NEW.table_id)
    )
    AND is_active = true;
  IF v_count < 2 THEN RAISE EXCEPTION 'tracker_blind_roster_unavailable'; END IF;

  SELECT id, tracker_sb_position, tracker_bb_position INTO v_prior
  FROM public.tournament_hands
  WHERE tournament_id = NEW.tournament_id AND table_id = NEW.table_id
    AND table_session_id = NEW.table_session_id AND hand_number < NEW.hand_number
    AND status = 'completed' AND COALESCE(is_voided, false) = false
  ORDER BY hand_number DESC LIMIT 1;
  IF FOUND THEN
    v_prior_sb := v_prior.tracker_sb_position;
    v_prior_bb := v_prior.tracker_bb_position;
    IF v_prior_sb IS NULL THEN
      SELECT player.seat_number INTO v_prior_sb
      FROM public.hand_actions action_row
      JOIN public.hand_players player ON player.hand_id = action_row.hand_id
        AND player.player_id = action_row.player_id
        AND player.entry_number = action_row.entry_number
      WHERE action_row.hand_id = v_prior.id AND action_row.action_type = 'post_sb'
      ORDER BY action_row.action_order DESC LIMIT 1;
    END IF;
    IF v_prior_bb IS NULL THEN
      SELECT player.seat_number INTO v_prior_bb
      FROM public.hand_actions action_row
      JOIN public.hand_players player ON player.hand_id = action_row.hand_id
        AND player.player_id = action_row.player_id
        AND player.entry_number = action_row.entry_number
      WHERE action_row.hand_id = v_prior.id AND action_row.action_type = 'post_bb'
      ORDER BY action_row.action_order DESC LIMIT 1;
    END IF;
  END IF;

  IF v_count = 2 THEN
    IF NOT NEW.button_seat = ANY(v_seats) THEN
      RAISE EXCEPTION 'tracker_heads_up_button_unoccupied';
    END IF;
    v_sb := NEW.button_seat;
    SELECT seat INTO v_bb FROM unnest(v_seats) AS seat WHERE seat <> v_sb LIMIT 1;
  ELSIF v_prior_sb IS NOT NULL AND v_prior_bb IS NOT NULL
    AND NEW.button_seat = v_prior_sb THEN
    -- The old BB position is the new SB position, even if that seat busted.
    v_sb := v_prior_bb;
    SELECT seat INTO v_bb FROM unnest(v_seats) AS seat
      WHERE seat > v_prior_bb ORDER BY seat LIMIT 1;
    v_bb := COALESCE(v_bb, v_seats[1]);
  ELSE
    -- First hand or explicit Dealer button override.
    SELECT seat INTO v_sb FROM unnest(v_seats) AS seat
      WHERE seat > NEW.button_seat ORDER BY seat LIMIT 1;
    v_sb := COALESCE(v_sb, v_seats[1]);
    SELECT seat INTO v_bb FROM unnest(v_seats) AS seat
      WHERE seat > v_sb ORDER BY seat LIMIT 1;
    v_bb := COALESCE(v_bb, v_seats[1]);
  END IF;
  NEW.tracker_sb_position := v_sb;
  NEW.tracker_bb_position := v_bb;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_tracker_hand_v3(p_tournament_id uuid, p_tournament_table_id uuid, p_table_session_id uuid, p_control_epoch bigint, p_hand_number integer, p_hand_time timestamp with time zone, p_created_by uuid, p_button_seat integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_table public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
  v_game_table_id uuid;
  v_hand_id uuid;
  v_bad_seat integer;
BEGIN
  IF v_actor IS NULL OR (p_created_by IS NOT NULL AND p_created_by <> v_actor) THEN
    RETURN pg_catalog.jsonb_build_object('error', 'actor_mismatch');
  END IF;
  IF p_tournament_id IS NULL OR p_tournament_table_id IS NULL OR p_table_session_id IS NULL
     OR p_control_epoch IS NULL OR p_hand_number IS NULL OR p_hand_number < 1
     OR p_button_seat IS NULL OR p_button_seat NOT BETWEEN 1 AND 9 THEN
    RETURN pg_catalog.jsonb_build_object('error', 'invalid_hand_context');
  END IF;

  SELECT t.club_id INTO v_club_id FROM public.tournaments t
  WHERE t.id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR public.is_club_tracker(v_actor, v_club_id) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('error', 'actor_not_allowed');
  END IF;
  SELECT tt.game_table_id INTO v_game_table_id FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id AND tt.tournament_id = p_tournament_id;
  IF v_game_table_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('error', 'table_not_found');
  END IF;
  PERFORM 1 FROM public.game_tables gt WHERE gt.id = v_game_table_id
    AND gt.club_id = v_club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('error', 'table_scope_mismatch');
  END IF;
  SELECT * INTO v_session FROM public.table_sessions session_row
  WHERE session_row.id = p_table_session_id FOR UPDATE;
  SELECT * INTO v_table FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id AND tt.tournament_id = p_tournament_id FOR UPDATE;
  IF v_table.table_session_id IS DISTINCT FROM v_session.id
     OR v_table.game_table_id IS DISTINCT FROM v_game_table_id
     OR v_table.status IS DISTINCT FROM 'active'
     OR v_session.closed_at IS NOT NULL
     OR v_session.club_id IS DISTINCT FROM v_club_id
     OR v_session.tournament_id IS DISTINCT FROM p_tournament_id
     OR v_session.game_table_id IS DISTINCT FROM v_game_table_id
     OR v_session.control_mode IS DISTINCT FROM 'tracker'
     OR v_session.control_epoch IS DISTINCT FROM p_control_epoch THEN
    RETURN pg_catalog.jsonb_build_object('error', 'STALE_TRACKER_CONTEXT');
  END IF;
  IF p_button_seat > v_table.max_seats THEN
    RETURN pg_catalog.jsonb_build_object('error', 'invalid_button_seat');
  END IF;
  -- Coordinate with the legacy writer on the same assignment during cutover.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_tournament_id::text), pg_catalog.hashtext(v_table.id::text));
  IF EXISTS (SELECT 1 FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id AND h.status = 'in_progress'
      AND COALESCE(h.is_voided, false) = false
      AND (h.table_session_id = v_session.id OR h.tournament_table_id = v_table.id
           OR h.table_id IN (v_table.id, v_game_table_id))) THEN
    RETURN pg_catalog.jsonb_build_object('error', 'table_has_active_hand');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id AND s.tournament_table_id = v_table.id
      AND s.table_session_id = v_session.id AND s.is_active) THEN
    RETURN pg_catalog.jsonb_build_object('error', 'table_has_no_players');
  END IF;
  SELECT s.seat_number INTO v_bad_seat FROM public.tournament_seats s
  LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id = s.tournament_id
    AND cc.player_id = s.player_id AND cc.entry_number = s.entry_number
  WHERE s.tournament_id = p_tournament_id AND s.tournament_table_id = v_table.id
    AND s.table_session_id = v_session.id AND s.is_active
    AND (s.entry_id IS NULL OR COALESCE(cc.chip_count, s.chip_count, 0) <= 0)
  LIMIT 1;
  IF v_bad_seat IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('error', 'invalid_seat_stack', 'seat_number', v_bad_seat);
  END IF;

  INSERT INTO public.tournament_hands (
    tournament_id, table_id, tournament_table_id, table_session_id,
    hand_number, hand_time, community_cards, pot_size, side_pots,
    status, created_by, locked_by_user_id, locked_at, button_seat
  ) VALUES (
    p_tournament_id, v_table.id, v_table.id, v_session.id,
    p_hand_number, COALESCE(p_hand_time, pg_catalog.now()), '[]'::jsonb,
    0, '[]'::jsonb, 'in_progress', v_actor, v_actor, pg_catalog.now(), p_button_seat
  ) RETURNING id INTO v_hand_id;
  INSERT INTO public.hand_players (
    hand_id, tournament_id, player_id, entry_number, seat_number,
    starting_stack, ending_stack, is_eliminated, side_pots, hole_cards,
    player_name, avatar_url
  )
  SELECT v_hand_id, p_tournament_id, s.player_id, s.entry_number, s.seat_number,
    COALESCE(cc.chip_count, s.chip_count, 0), NULL, false, '[]'::jsonb, '[]'::jsonb,
    s.player_name, s.avatar_url
  FROM public.tournament_seats s
  LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id = s.tournament_id
    AND cc.player_id = s.player_id AND cc.entry_number = s.entry_number
  WHERE s.tournament_id = p_tournament_id AND s.tournament_table_id = v_table.id
    AND s.table_session_id = v_session.id AND s.is_active;
  RETURN pg_catalog.jsonb_build_object('status', 'success', 'hand_id', v_hand_id,
    'button_seat', p_button_seat);
EXCEPTION WHEN unique_violation THEN
  RETURN pg_catalog.jsonb_build_object('error', 'table_has_active_hand');
END;
$function$;
DO $post$ BEGIN
 IF md5(replace(pg_get_functiondef('floor_private.snapshot_tracker_hand_blinds()'::regprocedure),chr(13),''))<>'81554940f984d3349149cdeed959626e' THEN RAISE EXCEPTION 'deployed_identity_dependency_postcheck'; END IF;
 IF md5(replace(pg_get_functiondef('start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamp with time zone,uuid,integer)'::regprocedure),chr(13),''))<>'6b71e798f6239b7096342ef7e17e6784' THEN RAISE EXCEPTION 'deployed_identity_dependency_postcheck'; END IF;
END $post$;
COMMIT;
