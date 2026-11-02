-- LOCAL candidate: validate contested pot eligibility and uncalled refund at shared server writer.
DO $pre$ BEGIN IF to_regprocedure('floor_private.tracker_manual_payouts_match_v1(jsonb,jsonb,jsonb)') IS NOT NULL OR md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'26c27c18eead389f7798b81244d74313' THEN RAISE EXCEPTION 'tracker_payout316_definition_drift_or_collision';END IF;END $pre$;

-- Pot layers have nested eligibility sets. For each suffix, its eligible players
-- must receive at least all chips in that suffix. Together with nonnegative
-- awards and exact total, this is feasibility for the nested sets, not hand ranking.
CREATE FUNCTION floor_private.tracker_manual_payouts_match_v1(p_actions jsonb,p_players jsonb,p_pots jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE player jsonb;layer jsonb;committed numeric;refund numeric:=0;top_id text;top_amount numeric;second_amount numeric;top_folded boolean;awards jsonb:='{}'::jsonb;award numeric;total_awards numeric:=0;required numeric:=0;available numeric;v_layer_amount numeric;key text;
BEGIN
 IF jsonb_typeof(p_players)<>'array' OR jsonb_typeof(p_actions)<>'array' OR jsonb_typeof(p_pots)<>'array' THEN RETURN false;END IF;
 IF (SELECT count(*)<>count(DISTINCT p->>'player_id') FROM jsonb_array_elements(p_players)p) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_actions)a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_players)p WHERE p->>'player_id'=a->>'player_id')) THEN RETURN false;END IF;
 WITH c AS(SELECT a->>'player_id' id,sum(CASE WHEN a->>'action_type' IN('bet','raise','call','all_in','post_sb','post_bb','post_ante') THEN greatest(trunc(coalesce((a->>'action_amount')::numeric,0)),0) ELSE 0 END) amount,bool_or(a->>'action_type'='fold') folded FROM jsonb_array_elements(p_actions)a GROUP BY a->>'player_id'),ranked AS(SELECT *,lead(amount,1,0::numeric) OVER(ORDER BY amount DESC,id) next_amount FROM c)
 SELECT id,amount,next_amount,folded INTO top_id,top_amount,second_amount,top_folded FROM ranked ORDER BY amount DESC,id LIMIT 1;
 IF top_amount>second_amount AND NOT coalesce(top_folded,false) THEN refund:=top_amount-second_amount;END IF;
 FOR player IN SELECT p FROM jsonb_array_elements(p_players)p LOOP
  key:=player->>'player_id';IF key IS NULL OR jsonb_typeof(player->'starting_stack')<>'number' OR jsonb_typeof(player->'ending_stack')<>'number' THEN RETURN false;END IF;
  IF (player->>'starting_stack')::numeric<>trunc((player->>'starting_stack')::numeric) OR (player->>'ending_stack')::numeric<>trunc((player->>'ending_stack')::numeric) THEN RETURN false;END IF;
  SELECT coalesce(sum(greatest(trunc(coalesce((a->>'action_amount')::numeric,0)),0)),0) INTO committed FROM jsonb_array_elements(p_actions)a WHERE a->>'player_id'=key AND a->>'action_type' IN('bet','raise','call','all_in','post_sb','post_bb','post_ante');
  IF committed>(player->>'starting_stack')::numeric THEN RETURN false;END IF;
  award:=(player->>'ending_stack')::numeric-((player->>'starting_stack')::numeric-committed+CASE WHEN key=top_id THEN refund ELSE 0 END);
  IF award<0 THEN RETURN false;END IF;awards:=awards||jsonb_build_object(key,award);total_awards:=total_awards+award;
 END LOOP;
 FOR layer IN SELECT p FROM jsonb_array_elements(p_pots) WITH ORDINALITY t(p,n) ORDER BY n DESC LOOP
  v_layer_amount:=(layer->>'amount')::numeric;IF v_layer_amount<=0 OR v_layer_amount<>trunc(v_layer_amount) OR jsonb_array_length(layer->'eligible_player_ids')=0 THEN RETURN false;END IF;
  required:=required+v_layer_amount;
  SELECT coalesce(sum((awards->>id)::numeric),0) INTO available FROM jsonb_array_elements_text(layer->'eligible_player_ids')id;
  IF available<required THEN RETURN false;END IF;
 END LOOP;
 RETURN total_awards=required;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION floor_private.tracker_manual_payouts_match_v1(jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
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
  v_finish_context JSONB;
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


  IF NOT floor_private.tracker_manual_pots_match_v1(p_actions,COALESCE(p_side_pots,'[]'::jsonb),COALESCE(p_pot_size,0)) THEN
    RETURN jsonb_build_object('ok',false,'error','SIDE_POTS_TAMPERED');
  END IF;
  IF NOT floor_private.tracker_manual_payouts_match_v1(p_actions,p_players,COALESCE(p_side_pots,'[]'::jsonb)) THEN
    RETURN jsonb_build_object('ok',false,'error','PAYOUT_POTS_MISMATCH');
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


  -- Service-role direct EXECUTE remains revoked. Voice delegated actor authority
  -- is verified against the exact current session/config/epoch/assignment.
  IF v_service_voice_call THEN
    v_finish_context:=public._tracker_voice_assignment_context(p_tournament_id,v_tt.id,v_actor);
    IF COALESCE((v_finish_context->>'ok')::boolean,false) IS NOT TRUE THEN RETURN v_finish_context; END IF;
    IF v_tt.table_session_id IS DISTINCT FROM (v_finish_context->>'table_session_id')::uuid
       OR v_club_id IS DISTINCT FROM (v_finish_context->>'club_id')::uuid THEN
      RETURN jsonb_build_object('ok',false,'error','voice_finish_scope_mismatch');
    END IF;
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
    AND (NOT v_service_voice_call OR (h.table_session_id = v_tt.table_session_id AND h.tournament_table_id = v_tt.id))
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
    AND (NOT v_service_voice_call OR (h.table_session_id = v_tt.table_session_id AND h.tournament_table_id = v_tt.id))
    AND h.hand_number = p_hand_number
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false
  FOR UPDATE;


  -- v_hand was selected FOR UPDATE. Another actor cannot take over between
  -- this check and completion. Do not bypass manual ownership by club role.
  IF NOT v_service_voice_call AND v_hand.locked_by_user_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok',false,'error','lock_not_held');
  END IF;
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
    LEFT JOIN actions incoming ON incoming.action_order = existing.action_order
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
    -- Existing rows were checked against the complete payload under the hand lock.
    IF EXISTS (SELECT 1 FROM public.hand_actions existing
      WHERE existing.hand_id=v_hand.id
        AND existing.action_order=(v_action->>'action_order')::integer) THEN
      CONTINUE;
    END IF;
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
$function$
;
