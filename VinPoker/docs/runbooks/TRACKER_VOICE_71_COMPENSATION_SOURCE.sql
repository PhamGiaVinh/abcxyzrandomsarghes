-- Compensation SOURCE only. Promote unchanged to a NEW reviewed migration.
-- Package rollback order:71 then70, in transaction(s) with fresh recovery proof.
-- Never rewind completed hand/card/chip/receipt/ledger/audit rows.
BEGIN;
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'16006fec6f3b9274581de471a9dc296a'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_hand_state_version(uuid)'::regprocedure),chr(13),''))<>'f1f8d600607c96653f1ea1c0f950c119'
 OR (SELECT md5(jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)::text) FROM pg_proc WHERE oid='public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure)<>'66dbd325fdd934675b3f0cda2f792d18' THEN RAISE EXCEPTION 'rollback71_source_metadata_or_order_drift'; END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.record_hand(p_tournament_id uuid, p_table_id uuid, p_hand_number integer, p_hand_time timestamp with time zone, p_players jsonb, p_actions jsonb, p_side_pots jsonb DEFAULT '[]'::jsonb, p_community_cards jsonb DEFAULT '[]'::jsonb, p_pot_size integer DEFAULT 0, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_service_voice_call BOOLEAN := COALESCE(auth.jwt()->>'role', '') = 'service_role';
  v_club_id UUID;
  v_tt RECORD;
  v_hand RECORD;
  v_table_matches INTEGER;
  v_hand_matches INTEGER;
  v_snapshot_count INTEGER;
  v_payload_count INTEGER;
  v_payload_distinct INTEGER;
  v_invalid_players INTEGER;
  v_starting_total BIGINT;
  v_ending_total BIGINT;
  v_invalid_actions INTEGER;
  v_action_count INTEGER;
  v_action_distinct INTEGER;
  v_player JSONB;
  v_action JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_seat_number INTEGER;
  v_starting_stack INTEGER;
  v_ending_stack INTEGER;
  v_is_eliminated BOOLEAN;
  v_seat RECORD;
BEGIN
  IF v_service_voice_call THEN
    IF p_created_by IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voice_actor_required');
    END IF;
    v_actor := p_created_by;
  ELSIF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_created_by IS NOT NULL AND p_created_by IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_mismatch');
  END IF;

  IF p_tournament_id IS NULL OR p_table_id IS NULL OR p_hand_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_hand_identity');
  END IF;

  IF jsonb_typeof(p_players) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_actions) IS DISTINCT FROM 'array'
     OR jsonb_typeof(COALESCE(p_side_pots, '[]'::JSONB)) IS DISTINCT FROM 'array'
     OR jsonb_typeof(COALESCE(p_community_cards, '[]'::JSONB)) IS DISTINCT FROM 'array'
     OR COALESCE(p_pot_size, 0) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'malformed_hand_payload');
  END IF;

  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  IF NOT public.is_club_tracker(v_actor, v_club_id) AND NOT v_service_voice_call THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;

  SELECT count(*) INTO v_table_matches
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND (
      p_table_id = tt.id
      OR (
        p_table_id IN (tt.table_id, tt.game_table_id)
        AND (tt.table_session_id IS NULL OR EXISTS (
          SELECT 1 FROM public.table_sessions current_session
          WHERE current_session.id = tt.table_session_id
            AND current_session.closed_at IS NULL
        ))
      )
    );
  IF v_table_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  ELSIF v_table_matches <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_table_identity');
  END IF;

  SELECT tt.id, tt.table_id, tt.game_table_id, tt.table_session_id, tt.status
  INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
    AND (
      p_table_id = tt.id
      OR (
        p_table_id IN (tt.table_id, tt.game_table_id)
        AND (tt.table_session_id IS NULL OR EXISTS (
          SELECT 1 FROM public.table_sessions current_session
          WHERE current_session.id = tt.table_session_id
            AND current_session.closed_at IS NULL
        ))
      )
    )
  FOR UPDATE;

  -- Direct service_role execution remains impossible by ACL. The only service
  -- call is the Finish wrapper below, and this keeps its dealer identity bound
  -- to the same active physical-table assignment used by the Voice runtime.
  IF v_service_voice_call AND NOT EXISTS (
    SELECT 1
    FROM public.dealers d
    JOIN public.dealer_assignments da ON da.dealer_id = d.id
    JOIN public.tournament_tables assigned_tt
      ON da.table_id IN (assigned_tt.table_id, assigned_tt.game_table_id)
    WHERE d.user_id = v_actor
      AND d.club_id = v_club_id
      AND da.status = 'assigned'
      AND assigned_tt.id = v_tt.id
      AND assigned_tt.tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_dealer_assignment_required');
  END IF;

  SELECT count(*) INTO v_hand_matches
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND (
      (h.table_session_id = v_tt.table_session_id
        AND h.tournament_table_id = v_tt.id)
      OR (h.table_session_id IS NULL
        AND h.table_id IN (v_tt.id, v_tt.table_id))
    )
    AND h.hand_number = p_hand_number
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false;
  IF v_hand_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_hand_not_found');
  ELSIF v_hand_matches <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_active_hand');
  END IF;

  SELECT h.* INTO v_hand
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND (
      (h.table_session_id = v_tt.table_session_id
        AND h.tournament_table_id = v_tt.id)
      OR (h.table_session_id IS NULL
        AND h.table_id IN (v_tt.id, v_tt.table_id))
    )
    AND h.hand_number = p_hand_number
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false
  FOR UPDATE;

  PERFORM 1 FROM public.hand_players hp WHERE hp.hand_id = v_hand.id FOR UPDATE;
  PERFORM 1
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id
    AND (
        (s.tournament_table_id = v_tt.id
          AND s.table_session_id = v_tt.table_session_id)
        OR (s.tournament_table_id IS NULL AND s.table_id = v_tt.id)
      )
  FOR UPDATE;
  PERFORM 1
  FROM public.tournament_entries e
  WHERE e.id IN (
    SELECT s.entry_id
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id
      AND (
        (s.tournament_table_id = v_tt.id
          AND s.table_session_id = v_tt.table_session_id)
        OR (s.tournament_table_id IS NULL AND s.table_id = v_tt.id)
      )
      AND s.entry_id IS NOT NULL
  )
  FOR UPDATE;
  PERFORM 1
  FROM public.tournament_chip_counts c
  WHERE c.tournament_id = p_tournament_id
    AND EXISTS (
      SELECT 1
      FROM public.tournament_seats s
      WHERE s.tournament_id = c.tournament_id
        AND (
        (s.tournament_table_id = v_tt.id
          AND s.table_session_id = v_tt.table_session_id)
        OR (s.tournament_table_id IS NULL AND s.table_id = v_tt.id)
      )
        AND s.player_id = c.player_id
        AND s.entry_number = c.entry_number
    )
  FOR UPDATE;

  BEGIN
    SELECT
      count(*),
      count(DISTINCT (p.player_id, p.entry_number)),
      count(*) FILTER (
        WHERE p.player_id IS NULL
           OR p.entry_number IS NULL
           OR p.entry_number < 1
           OR p.seat_number IS NULL
           OR p.seat_number < 1
           OR p.starting_stack IS NULL
           OR p.starting_stack < 0
           OR p.ending_stack IS NULL
           OR p.ending_stack < 0
           OR p.is_eliminated IS NULL
           OR p.is_eliminated IS DISTINCT FROM (p.ending_stack = 0)
      ),
      COALESCE(sum(p.starting_stack), 0),
      COALESCE(sum(p.ending_stack), 0)
    INTO
      v_payload_count,
      v_payload_distinct,
      v_invalid_players,
      v_starting_total,
      v_ending_total
    FROM jsonb_to_recordset(p_players) AS p(
      player_id UUID,
      entry_number INTEGER,
      seat_number INTEGER,
      starting_stack INTEGER,
      ending_stack INTEGER,
      is_eliminated BOOLEAN,
      side_pots JSONB,
      hole_cards JSONB
    );
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'malformed_player_payload');
  END;

  SELECT count(*) INTO v_snapshot_count
  FROM public.hand_players hp
  WHERE hp.hand_id = v_hand.id;

  IF v_payload_count = 0
     OR v_payload_count <> v_payload_distinct
     OR v_invalid_players <> 0
     OR v_payload_count <> v_snapshot_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_snapshot_mismatch');
  END IF;

  IF v_starting_total <> v_ending_total THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'chip_conservation_failed',
      'starting_total', v_starting_total,
      'ending_total', v_ending_total
    );
  END IF;

  IF EXISTS (
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    ), snapshot AS (
      SELECT hp.player_id, hp.entry_number, hp.seat_number, hp.starting_stack
      FROM public.hand_players hp
      WHERE hp.hand_id = v_hand.id
    )
    SELECT 1
    FROM snapshot hp
    FULL JOIN payload p
      ON p.player_id = hp.player_id
     AND p.entry_number = hp.entry_number
    WHERE hp.player_id IS NULL
       OR p.player_id IS NULL
       OR p.seat_number IS DISTINCT FROM hp.seat_number
       OR p.starting_stack IS DISTINCT FROM hp.starting_stack
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_snapshot_mismatch');
  END IF;

  IF EXISTS (
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    )
    SELECT 1
    FROM payload p
    LEFT JOIN public.tournament_seats s
      ON s.tournament_id = p_tournament_id
     AND (
        (s.tournament_table_id = v_tt.id
          AND s.table_session_id = v_tt.table_session_id)
        OR (s.tournament_table_id IS NULL AND s.table_id = v_tt.id)
      )
     AND s.player_id = p.player_id
     AND s.entry_number = p.entry_number
     AND s.seat_number = p.seat_number
     AND s.is_active = true
    LEFT JOIN public.tournament_entries e
      ON e.id = s.entry_id
     AND e.tournament_id = p_tournament_id
     AND e.player_id = p.player_id
     AND e.entry_no = p.entry_number
     AND e.status = 'seated'
     AND (
       s.tournament_table_id IS NOT NULL
       OR (e.table_id IS NOT DISTINCT FROM v_tt.table_id
         AND e.seat_number IS NOT DISTINCT FROM p.seat_number)
     )
    LEFT JOIN public.tournament_chip_counts c
      ON c.tournament_id = p_tournament_id
     AND c.player_id = p.player_id
     AND c.entry_number = p.entry_number
    WHERE s.id IS NULL
       OR e.id IS NULL
       OR s.chip_count IS DISTINCT FROM p.starting_stack
       OR e.current_stack IS DISTINCT FROM p.starting_stack
       OR (c.player_id IS NOT NULL AND c.chip_count IS DISTINCT FROM p.starting_stack)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stack_or_entry_projection_mismatch');
  END IF;

  BEGIN
    SELECT
      count(*),
      count(DISTINCT a.action_order),
      count(*) FILTER (
        WHERE a.player_id IS NULL
           OR a.entry_number IS NULL
           OR a.action_order IS NULL
           OR a.action_order < 1
           OR NULLIF(btrim(a.action_type), '') IS NULL
      )
    INTO v_action_count, v_action_distinct, v_invalid_actions
    FROM jsonb_to_recordset(p_actions) AS a(
      player_id UUID,
      entry_number INTEGER,
      street TEXT,
      action_type TEXT,
      action_amount INTEGER,
      action_order INTEGER
    );
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'malformed_action_payload');
  END;

  IF v_action_count <> v_action_distinct OR v_invalid_actions <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'malformed_action_payload');
  END IF;

  IF EXISTS (
    WITH actions AS (
      SELECT *
      FROM jsonb_to_recordset(p_actions) AS a(
        player_id UUID,
        entry_number INTEGER,
        street TEXT,
        action_type TEXT,
        action_amount INTEGER,
        action_order INTEGER
      )
    ), players AS (
      SELECT p.player_id, p.entry_number
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    )
    SELECT 1
    FROM actions a
    LEFT JOIN players p
      ON p.player_id = a.player_id
     AND p.entry_number = a.entry_number
    WHERE p.player_id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'action_player_mismatch');
  END IF;

  IF EXISTS (
    WITH actions AS (
      SELECT *
      FROM jsonb_to_recordset(p_actions) AS a(
        player_id UUID,
        entry_number INTEGER,
        street TEXT,
        action_type TEXT,
        action_amount INTEGER,
        action_order INTEGER
      )
    )
    SELECT 1
    FROM public.hand_actions existing
    JOIN actions incoming ON incoming.action_order = existing.action_order
    WHERE existing.hand_id = v_hand.id
      AND (
        existing.player_id IS DISTINCT FROM incoming.player_id
        OR COALESCE(existing.entry_number, 1) IS DISTINCT FROM incoming.entry_number
        OR COALESCE(existing.street, 'preflop') IS DISTINCT FROM COALESCE(incoming.street, 'preflop')
        OR existing.action_type IS DISTINCT FROM incoming.action_type
        OR COALESCE(existing.action_amount, 0) IS DISTINCT FROM COALESCE(incoming.action_amount, 0)
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'action_conflict');
  END IF;

  UPDATE public.tournament_hands
  SET community_cards = COALESCE(p_community_cards, '[]'::JSONB),
      pot_size = COALESCE(p_pot_size, 0),
      side_pots = COALESCE(p_side_pots, '[]'::JSONB),
      status = 'completed',
      updated_at = now(),
      locked_by_user_id = NULL,
      locked_at = NULL
  WHERE id = v_hand.id;

  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_player_id := (v_player->>'player_id')::UUID;
    v_entry_number := (v_player->>'entry_number')::INTEGER;
    v_seat_number := (v_player->>'seat_number')::INTEGER;
    v_starting_stack := (v_player->>'starting_stack')::INTEGER;
    v_ending_stack := (v_player->>'ending_stack')::INTEGER;
    v_is_eliminated := (v_player->>'is_eliminated')::BOOLEAN;

    SELECT s.id, s.entry_id, s.player_name, s.avatar_url
    INTO v_seat
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id
      AND (
        (s.tournament_table_id = v_tt.id
          AND s.table_session_id = v_tt.table_session_id)
        OR (s.tournament_table_id IS NULL AND s.table_id = v_tt.id)
      )
      AND s.player_id = v_player_id
      AND s.entry_number = v_entry_number
      AND s.seat_number = v_seat_number
      AND s.is_active = true;

    UPDATE public.hand_players hp
    SET ending_stack = v_ending_stack,
        is_eliminated = v_is_eliminated,
        side_pots = COALESCE(v_player->'side_pots', '[]'::JSONB),
        hole_cards = COALESCE(v_player->'hole_cards', '[]'::JSONB),
        player_name = COALESCE(hp.player_name, v_seat.player_name),
        avatar_url = COALESCE(hp.avatar_url, v_seat.avatar_url)
    WHERE hp.hand_id = v_hand.id
      AND hp.player_id = v_player_id
      AND hp.entry_number = v_entry_number;

    UPDATE public.tournament_seats
    SET chip_count = v_ending_stack,
        is_active = NOT v_is_eliminated,
        status = CASE WHEN v_is_eliminated THEN 'busted' ELSE 'active' END
    WHERE id = v_seat.id;

    INSERT INTO public.tournament_chip_counts (
      tournament_id, player_id, entry_number, chip_count
    ) VALUES (
      p_tournament_id, v_player_id, v_entry_number, v_ending_stack
    )
    ON CONFLICT (tournament_id, player_id, entry_number)
    DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = now();

    UPDATE public.tournament_entries
    SET current_stack = v_ending_stack,
        status = CASE WHEN v_is_eliminated THEN 'busted' ELSE 'seated' END,
        busted_at = CASE
          WHEN v_is_eliminated THEN COALESCE(busted_at, now())
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = v_seat.entry_id;

    IF v_is_eliminated AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_eliminations te
      WHERE te.tournament_id = p_tournament_id
        AND te.player_id = v_player_id
        AND te.entry_number = v_entry_number
        AND te.hand_id = v_hand.id
    ) THEN
      INSERT INTO public.tournament_eliminations (
        tournament_id, player_id, entry_number, hand_id, position, prize
      ) VALUES (
        p_tournament_id, v_player_id, v_entry_number, v_hand.id, 0, 0
      );
    END IF;
  END LOOP;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    INSERT INTO public.hand_actions (
      hand_id, player_id, entry_number, street,
      action_type, action_amount, action_order
    ) VALUES (
      v_hand.id,
      (v_action->>'player_id')::UUID,
      (v_action->>'entry_number')::INTEGER,
      COALESCE(v_action->>'street', 'preflop'),
      v_action->>'action_type',
      COALESCE((v_action->>'action_amount')::INTEGER, 0),
      (v_action->>'action_order')::INTEGER
    )
    ON CONFLICT (hand_id, action_order) DO NOTHING;
  END LOOP;

  UPDATE public.tournaments
  SET players_remaining = (
        SELECT count(*)
        FROM public.tournament_seats s
        WHERE s.tournament_id = p_tournament_id
          AND s.is_active = true
      ),
      average_stack = (
        SELECT COALESCE(round(avg(s.chip_count)), 0)::INTEGER
        FROM public.tournament_seats s
        WHERE s.tournament_id = p_tournament_id
          AND s.is_active = true
      ),
      updated_at = now()
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'success',
    'hand_id', v_hand.id,
    'starting_total', v_starting_total,
    'ending_total', v_ending_total
  );
END;
$function$;
DO $postcheck$
BEGIN
 IF md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'b3bb09d6a873becb061ea05d6cecd4dd'
 OR (SELECT md5(jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)::text) FROM pg_proc WHERE oid='public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure)<>'66dbd325fdd934675b3f0cda2f792d18' THEN RAISE EXCEPTION 'rollback71_postcheck_failed'; END IF;
END;
$postcheck$;
COMMIT;
