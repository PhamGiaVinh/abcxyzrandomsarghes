-- Forward-only CV01: completed void must restore canonical entry stack.
-- DRAFT: session/seat dependency and concurrency gates still required before release.
-- Rollback: forward restore reviewed pre-apply void definition; preserve hand
-- revisions/audit. Never undo chip mutations by deleting history or receipts.
BEGIN;
DO $migration$
DECLARE definition text; marker text; replacement text;
BEGIN
 IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc
     WHERE oid='public.void_last_hand(uuid)'::regprocedure)
     IS DISTINCT FROM 'c9e37982f4aa9b66905d31645756f28b' THEN
  RAISE EXCEPTION 'completed_void_predecessor_drift';
 END IF;
 SELECT replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),E'\r','') INTO definition;
 marker:=E'  SELECT *\n  INTO v_hand_record\n  FROM public.tournament_hands';
 replacement:=$patch$  -- Lifecycle locks precede the hand tuple; never invert close's game/session order.
  PERFORM gt.id FROM public.game_tables gt JOIN public.table_sessions sess ON sess.game_table_id=gt.id
    JOIN public.tournament_hands h ON h.table_session_id=sess.id
    WHERE h.id=p_hand_id AND h.status='completed' AND gt.club_id=v_club_id
    ORDER BY gt.id FOR UPDATE OF gt;
  PERFORM sess.id FROM public.table_sessions sess JOIN public.tournament_hands h ON h.table_session_id=sess.id
    WHERE h.id=p_hand_id AND h.status='completed' ORDER BY sess.id FOR UPDATE OF sess;
  PERFORM tt.id FROM public.tournament_tables tt JOIN public.tournament_hands h ON h.table_session_id=tt.table_session_id
    WHERE h.id=p_hand_id AND h.status='completed' AND tt.tournament_id=v_tournament_id
    ORDER BY tt.id FOR UPDATE OF tt;
  SELECT *
  INTO v_hand_record
  FROM public.tournament_hands$patch$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'completed_void_lifecycle_lock_patch_missing'; END IF;
 definition:=replace(definition,marker,replacement);
 marker := E'  IF v_hand_record.status = ''completed'' THEN\n    FOR v_player_record IN';
 replacement := $patch$  IF v_hand_record.status = 'completed' THEN
    IF EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=v_tournament_id)
      OR EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=v_tournament_id) THEN
      RETURN jsonb_build_object('error','void_result_dependency');
    END IF;
    IF v_hand_record.table_session_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.table_sessions sess JOIN public.tournament_tables tt
        ON tt.table_session_id=sess.id AND tt.tournament_id=v_tournament_id
        AND tt.game_table_id=sess.game_table_id
      JOIN public.game_tables gt ON gt.id=sess.game_table_id AND gt.club_id=v_club_id
      WHERE sess.id=v_hand_record.table_session_id AND sess.closed_at IS NULL
        AND sess.tournament_id=v_tournament_id AND tt.status='active') THEN
      RETURN jsonb_build_object('error','void_session_mismatch');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_entries later
      ON later.tournament_id=v_tournament_id AND later.player_id=hp.player_id
      AND later.entry_no>hp.entry_number AND later.status<>'cancelled'
      WHERE hp.hand_id=p_hand_id) THEN
      RETURN jsonb_build_object('error','void_reentry_dependency');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=p_hand_id
      AND (SELECT count(*) FROM public.tournament_entries e WHERE e.tournament_id=v_tournament_id
        AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number)<>1) THEN
      RETURN jsonb_build_object('error','void_entry_identity_ambiguous');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp
      JOIN public.tournament_tables tt ON tt.table_session_id=v_hand_record.table_session_id
        AND tt.tournament_id=v_tournament_id AND tt.status='active'
      WHERE hp.hand_id=p_hand_id AND (hp.seat_number IS NULL OR hp.seat_number<1
        OR tt.max_seats IS NULL OR hp.seat_number>tt.max_seats)) THEN
      RETURN jsonb_build_object('error','void_seat_capacity');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_entries e
      ON e.tournament_id=v_tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      JOIN public.tournament_seats occupied ON occupied.table_session_id=v_hand_record.table_session_id
        AND occupied.seat_number=hp.seat_number AND occupied.is_active
        AND occupied.entry_id IS DISTINCT FROM e.id
      WHERE hp.hand_id=p_hand_id) THEN
      RETURN jsonb_build_object('error','void_seat_occupied');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=p_hand_id
      AND (SELECT count(*) FROM public.tournament_chip_counts c
        WHERE c.tournament_id=v_tournament_id AND c.player_id=hp.player_id
          AND c.entry_number=hp.entry_number)<>1) THEN
      RETURN jsonb_build_object('error','void_chip_projection_missing');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_entries e
      ON e.tournament_id=v_tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      WHERE hp.hand_id=p_hand_id AND (SELECT count(*) FROM public.tournament_seats s
        WHERE s.tournament_id=v_tournament_id AND s.entry_id=e.id
          AND s.player_id=hp.player_id AND s.entry_number=hp.entry_number
          AND s.table_session_id=v_hand_record.table_session_id AND s.seat_number=hp.seat_number
          AND s.status IN ('active','busted'))<>1) THEN
      RETURN jsonb_build_object('error','void_seat_dependency');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_entries e
      ON e.tournament_id=v_tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      WHERE hp.hand_id=p_hand_id AND (hp.starting_stack IS NULL OR hp.starting_stack<0
        OR hp.ending_stack IS NULL OR e.current_stack IS DISTINCT FROM hp.ending_stack)) THEN
      RETURN jsonb_build_object('error','void_stack_dependency');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_entries e
      ON e.tournament_id=v_tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      WHERE hp.hand_id=p_hand_id AND (e.status NOT IN ('seated','busted')
        OR (e.status='busted' AND (hp.is_eliminated IS DISTINCT FROM true OR hp.ending_stack IS DISTINCT FROM 0)))) THEN
      RETURN jsonb_build_object('error','void_entry_state_dependency');
    END IF;
    IF EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_entries e
      ON e.tournament_id=v_tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      JOIN public.table_session_seat_locks l ON l.table_session_id=v_hand_record.table_session_id
        AND l.seat_number=hp.seat_number AND l.unlocked_at IS NULL
      WHERE hp.hand_id=p_hand_id AND e.status='busted') THEN
      RETURN jsonb_build_object('error','void_seat_locked');
    END IF;
    FOR v_player_record IN$patch$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'completed_void_guard_patch_missing'; END IF;
 definition:=replace(definition,marker,replacement);
 marker:=E'        AND t.entry_number = v_player_record.entry_number;';
 replacement:=$patch$        AND t.entry_number = v_player_record.entry_number
        AND t.table_session_id = v_hand_record.table_session_id
        AND t.seat_number = v_player_record.seat_number
        AND EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.id=t.entry_id
          AND e.tournament_id=v_tournament_id AND e.player_id=v_player_record.player_id
          AND e.entry_no=v_player_record.entry_number);$patch$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'completed_void_seat_patch_missing'; END IF;
 definition:=replace(definition,marker,replacement);
 marker:=E'    END LOOP;\n\n    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;';
 replacement:=$patch$    END LOOP;
    UPDATE public.tournament_entries e SET current_stack=hp.starting_stack,
      status=CASE WHEN e.status='busted' THEN 'seated' ELSE e.status END,
      busted_at=CASE WHEN e.status='busted' THEN NULL ELSE e.busted_at END,
      updated_at=now()
    FROM public.hand_players hp WHERE hp.hand_id=p_hand_id
      AND e.tournament_id=v_tournament_id AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number;

    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;$patch$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'completed_void_projection_patch_missing'; END IF;
 EXECUTE replace(definition,marker,replacement);
END $migration$;
COMMIT;
