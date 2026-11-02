-- CLI generated20261024040125; catalog275 free after reviewed274.
-- Repair the missed redraw writer, not historical rows. Entry participation,
-- stack, cash and qualification remain unchanged. Move receipts are replaced
-- atomically using the established superseded/issued audit lifecycle.
-- Recovery: hold redraw apply, forward-restore saved definition after review;
-- never rewrite old seats/receipts or undo an applied redraw by deleting audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $pre$
DECLARE p pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='public.floor_apply_tournament_redraw_v1(uuid,uuid)'::regprocedure;
 IF current_user<>'postgres' OR md5(replace(p.prosrc,chr(13),''))<>'60a64510a4f4029945be6328a9c42b3d'
 OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 OR to_regclass('floor_private.redraw_tuple_pre275') IS NOT NULL
 OR to_regprocedure('private.multi_day_prepare_floor_seat_move_v1(uuid,uuid,uuid,uuid,integer,bigint,uuid)') IS NULL
 THEN RAISE EXCEPTION 'redraw275_precondition_drift';END IF;
END $pre$;
CREATE TABLE floor_private.redraw_tuple_pre275 AS
 SELECT pg_get_functiondef('public.floor_apply_tournament_redraw_v1(uuid,uuid)'::regprocedure) definition;
REVOKE ALL ON floor_private.redraw_tuple_pre275 FROM PUBLIC,anon,authenticated,service_role;
DO $repair$
DECLARE definition text; old_block text; new_block text; decl text;
BEGIN
 definition:=replace(pg_get_functiondef('public.floor_apply_tournament_redraw_v1(uuid,uuid)'::regprocedure),chr(13),'');
 decl:='  v_move public.tournament_redraw_moves%ROWTYPE;';
 IF length(definition)-length(replace(definition,decl,''))<>length(decl) THEN RAISE EXCEPTION 'redraw275_declaration_anchor';END IF;
 definition:=replace(definition,decl,decl||E'\n  v_source_seat public.tournament_seats%ROWTYPE;\n  v_entry public.tournament_entries%ROWTYPE;\n  v_new_seat_id uuid; v_ticket_code text; v_ticket_attempt integer; v_player_name text;');
 old_block:=$old$    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, tournament_table_id, table_session_id,
      seat_number, chip_count, is_active, entry_id, status, assigned_by, assigned_at
    ) VALUES (
      v_tournament.id, v_move.player_id, v_move.entry_number,
      v_move.applied_tournament_table_id, v_move.applied_table_session_id,
      v_move.to_seat_number, v_move.chip_count, true, v_move.entry_id,
      'active', v_actor, now()
    );$old$;
 new_block:=$new$    SELECT * INTO v_entry FROM public.tournament_entries e WHERE e.id=v_move.entry_id FOR UPDATE;
    IF v_entry.id IS NULL OR v_entry.tournament_id IS DISTINCT FROM v_tournament.id
      OR v_entry.player_id IS DISTINCT FROM v_move.player_id
      OR v_entry.entry_no IS DISTINCT FROM v_move.entry_number
      OR v_entry.status IS DISTINCT FROM 'seated'
      OR v_entry.current_stack IS DISTINCT FROM v_move.chip_count THEN
      RAISE EXCEPTION 'redraw_entry_identity_changed';
    END IF;
    -- The batch deactivated every old seat before this loop. The still-current
    -- entry pointer identifies exactly that source even after repeated redraws.
    SELECT * INTO v_source_seat FROM public.tournament_seats s
      WHERE s.id=v_entry.seat_id AND s.entry_id=v_entry.id
        AND s.tournament_id=v_tournament.id AND s.player_id=v_move.player_id
        AND s.entry_number=v_move.entry_number
        AND s.tournament_table_id=v_move.from_tournament_table_id
        AND s.table_session_id=v_move.from_table_session_id
        AND s.seat_number=v_move.from_seat_number AND s.chip_count=v_move.chip_count
        AND NOT s.is_active AND s.status='moved' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'redraw_source_entry_pointer_changed';END IF;
    v_new_seat_id:=pg_catalog.gen_random_uuid();
    PERFORM private.multi_day_prepare_floor_seat_move_v1(v_source_seat.id,v_new_seat_id,
      v_move.applied_tournament_table_id,v_move.applied_table_session_id,
      v_move.to_seat_number,v_move.chip_count,v_actor);
    INSERT INTO public.tournament_seats (
      id,tournament_id, player_id, entry_number,table_id,tournament_table_id, table_session_id,
      seat_number, chip_count, is_active, entry_id, status, assigned_by, assigned_at,player_name,avatar_url
    ) VALUES (
      v_new_seat_id,v_tournament.id, v_move.player_id, v_move.entry_number,
      v_move.applied_tournament_table_id,v_move.applied_tournament_table_id, v_move.applied_table_session_id,
      v_move.to_seat_number, v_move.chip_count, true, v_move.entry_id,
      'active', v_actor, now(),v_source_seat.player_name,v_source_seat.avatar_url
    );
    DELETE FROM private.multi_day_final_write_intents_v1
      WHERE transaction_id=pg_catalog.txid_current() AND backend_pid=pg_catalog.pg_backend_pid()
        AND kind='seat' AND row_id=v_new_seat_id AND consumed;
    UPDATE public.tournament_entries e
      SET table_id=destination.game_table_id,seat_id=v_new_seat_id,
        seat_number=v_move.to_seat_number,current_stack=v_move.chip_count,updated_at=now()
      FROM public.tournament_tables destination
      WHERE e.id=v_entry.id AND e.status='seated' AND e.seat_id=v_source_seat.id
        AND destination.id=v_move.applied_tournament_table_id
        AND destination.tournament_id=v_tournament.id
        AND destination.table_session_id=v_move.applied_table_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'redraw_entry_state_changed';END IF;
    INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
      VALUES(v_tournament.id,v_move.player_id,v_move.entry_number,v_move.chip_count)
      ON CONFLICT(tournament_id,player_id,entry_number) DO UPDATE
      SET chip_count=EXCLUDED.chip_count,updated_at=now();
    UPDATE public.seat_draw_receipts SET status='superseded',cancelled_at=now()
      WHERE entry_id=v_entry.id AND status IN('issued','printed');
    v_player_name:=COALESCE(NULLIF(v_source_seat.player_name,''),NULLIF(v_move.player_display_name,''),v_move.player_id::text);
    v_ticket_attempt:=0;
    LOOP
      v_ticket_attempt:=v_ticket_attempt+1;
      v_ticket_code:=pg_catalog.format('T%s-S%s-%s',v_move.to_table_number,v_move.to_seat_number,
        pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,6)));
      BEGIN
        INSERT INTO public.seat_draw_receipts(tournament_id,registration_id,entry_id,player_id,display_name,
          table_id,table_number,seat_id,seat_number,receipt_code,qr_payload,draw_type,status,issued_by)
        VALUES(v_tournament.id,v_entry.registration_id,v_entry.id,v_entry.player_id,v_player_name,
          v_move.to_game_table_id,v_move.to_table_number,v_new_seat_id,v_move.to_seat_number,v_ticket_code,
          pg_catalog.jsonb_build_object('v',1,'receipt_code',v_ticket_code,'entry_id',v_entry.id,
            'tournament_id',v_tournament.id,'player_id',v_entry.player_id,'table_number',v_move.to_table_number,
            'seat_number',v_move.to_seat_number,'redraw_batch_id',v_batch.id,'reason','floor_redraw_v1'),
          'manual_move','issued',v_actor);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_ticket_attempt>=5 THEN RAISE;END IF;
      END;
    END LOOP;$new$;
 IF length(definition)-length(replace(definition,old_block,''))<>length(old_block)
 THEN RAISE EXCEPTION 'redraw275_insert_anchor';END IF;
 definition:=replace(definition,old_block,new_block);
 old_block:=$old$'to_table_session_id', v_move.applied_table_session_id,
        'target_max_seats', v_batch.target_max_seats$old$;
 new_block:=$new$'to_table_session_id', v_move.applied_table_session_id,
        'seat_id',v_new_seat_id,'receipt_code',v_ticket_code,
        'target_max_seats', v_batch.target_max_seats$new$;
 IF length(definition)-length(replace(definition,old_block,''))<>length(old_block)
 THEN RAISE EXCEPTION 'redraw275_audit_anchor';END IF;
 EXECUTE replace(definition,old_block,new_block);
END $repair$;
COMMIT;
