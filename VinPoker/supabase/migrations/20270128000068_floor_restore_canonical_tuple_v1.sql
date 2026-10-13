-- CLI candidate20261013122526; forward68 checked absent in source/live catalog.
-- Restore must update the canonical entry backlink and issue a provable current
-- seat ticket. Preserve stored stack, old seats, receipts, payout and audit.
-- ROLLBACK: forward restore the pinned pre-apply helper and disable restore UI;
-- retain restored seats/tickets/history. Never rewrite ledger or historical rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $restore68$
DECLARE
 fn regprocedure:=to_regprocedure('floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)');
 proc pg_proc%ROWTYPE; definition text; old_text text; new_text text;
BEGIN
 SELECT * INTO proc FROM pg_proc WHERE oid=fn;
 IF fn IS NULL OR md5(replace(proc.prosrc,chr(13),''))<>'c8c66b3a511399fac6e05921a8791d91'
  OR proc.proowner<>'postgres'::regrole OR NOT proc.prosecdef
  OR proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR proc.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'restore68_baseline_drift'; END IF;
 definition:=replace(pg_get_functiondef(fn),chr(13),'');
 old_text:='  v_result jsonb;';
 new_text:='  v_result jsonb; v_ticket_code text; v_ticket_id uuid; v_display_name text; v_ticket_attempts integer:=0;';
 IF length(definition)-length(replace(definition,old_text,''))<>length(old_text) THEN RAISE EXCEPTION 'restore68_declaration_drift'; END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=E'      assigned_by,\n      assigned_at\n    ) VALUES (';
 new_text:=E'      assigned_by,\n      assigned_at, table_id, player_name, avatar_url\n    ) VALUES (';
 IF length(definition)-length(replace(definition,old_text,''))<>length(old_text) THEN RAISE EXCEPTION 'restore68_columns_drift'; END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=E'      v_actor,\n      pg_catalog.now()\n    )\n    RETURNING id INTO v_new_seat_id;';
 new_text:=E'      v_actor,\n      pg_catalog.now(), v_destination_table.id, v_busted_seat.player_name, v_busted_seat.avatar_url\n    )\n    RETURNING id INTO v_new_seat_id;';
 IF length(definition)-length(replace(definition,old_text,''))<>length(old_text) THEN RAISE EXCEPTION 'restore68_values_drift'; END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=E'        current_stack = v_stack,\n        busted_at = NULL,';
 new_text:=E'        current_stack = v_stack,\n        table_id = v_game_table_id, seat_id = v_new_seat_id, seat_number = p_to_seat_number,\n        busted_at = NULL,';
 IF length(definition)-length(replace(definition,old_text,''))<>length(old_text) THEN RAISE EXCEPTION 'restore68_backlink_drift'; END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=E'  SELECT pg_catalog.count(*)::integer INTO v_remaining FROM public.tournament_seats';
 new_text:=$ticket$
  -- Current ticket/audit is part of this atomic restore, not a client side effect.
  -- Retire only prior current tickets for this exact participation instance.
  UPDATE public.seat_draw_receipts SET status='cancelled',cancelled_at=pg_catalog.now()
  WHERE tournament_id=v_tournament.id AND entry_id=v_entry.id
    AND status IN ('issued','printed') AND cancelled_at IS NULL;
  SELECT COALESCE(NULLIF(pg_catalog.btrim(s.player_name),''),
    NULLIF(pg_catalog.btrim(p.display_name),''),v_entry.player_id::text)
    INTO v_display_name FROM public.tournament_seats s
    LEFT JOIN public.profiles p ON p.user_id=s.player_id WHERE s.id=v_new_seat_id;
  LOOP
    v_ticket_attempts:=v_ticket_attempts+1;
    v_ticket_code:=pg_catalog.format('T%s-S%s-%s',v_destination_table.table_number,p_to_seat_number,
      pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text,'-',''),1,6)));
    BEGIN
      INSERT INTO public.seat_draw_receipts(tournament_id,registration_id,entry_id,player_id,
        display_name,table_id,table_number,seat_id,seat_number,receipt_code,qr_payload,draw_type,status,issued_by)
      VALUES(v_tournament.id,v_entry.registration_id,v_entry.id,v_entry.player_id,v_display_name,
        v_game_table_id,v_destination_table.table_number,v_new_seat_id,p_to_seat_number,v_ticket_code,
        pg_catalog.jsonb_build_object('v',1,'receipt_code',v_ticket_code,'entry_id',v_entry.id,
          'tournament_id',v_tournament.id,'player_id',v_entry.player_id,'table_number',v_destination_table.table_number,
          'seat_number',p_to_seat_number,'source','floor'),'initial','issued',v_actor)
      RETURNING id INTO v_ticket_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN IF v_ticket_attempts>=5 THEN RAISE; END IF;
    END;
  END LOOP;
  INSERT INTO public.seat_assignment_history(tournament_id,entry_id,player_id,to_table_id,
    to_table_number,to_seat_number,reason,draw_type,actor_user_id,metadata)
  VALUES(v_tournament.id,v_entry.id,v_entry.player_id,v_game_table_id,v_destination_table.table_number,
    p_to_seat_number,'floor_restore_bust','initial',v_actor,
    pg_catalog.jsonb_build_object('source','floor','money',false,'request_id',p_request_id,
      'to_tournament_table_id',v_destination_table.id,'destination_session_id',v_destination_session.id,
      'control_epoch',v_destination_session.control_epoch,'receipt_code',v_ticket_code,'chip_count_at_move',v_stack));
  SELECT pg_catalog.count(*)::integer INTO v_remaining FROM public.tournament_seats$ticket$;
 IF length(definition)-length(replace(definition,old_text,''))<>length(old_text) THEN RAISE EXCEPTION 'restore68_ticket_seam_drift'; END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=E'    ''payout_applied'', false';
 new_text:=E'    ''payout_applied'', false, ''receipt_id'',v_ticket_id,''receipt_code'',v_ticket_code';
 IF length(definition)-length(replace(definition,old_text,''))<>length(old_text) THEN RAISE EXCEPTION 'restore68_result_drift'; END IF;
 definition:=replace(definition,old_text,new_text);
 EXECUTE definition;
END $restore68$;
DO $restore68_postcheck$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc
  WHERE oid='floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)'::regprocedure
   AND md5(replace(prosrc,chr(13),''))='ca72a3aa2e2b1681407b6289bd8f4a2a'
   AND proowner='postgres'::regrole AND prosecdef
   AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'restore68_postcheck_failed'; END IF;
END $restore68_postcheck$;
COMMIT;
