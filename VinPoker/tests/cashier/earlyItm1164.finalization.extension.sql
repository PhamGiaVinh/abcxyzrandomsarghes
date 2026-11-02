 DECLARE order_ids uuid[];next_entry uuid;next_revision bigint;next_epoch bigint;next_stack integer;
 context jsonb;result jsonb;money_before text;money_after text;winner record;closing_table record;close_id uuid;
 BEGIN
  PERFORM set_config('role','none',true);
  SELECT array_agg(entry_id ORDER BY finished_place) INTO order_ids FROM private.multi_day_individual_results_v1 WHERE event_id=event;
  FOR i IN 3..7 LOOP
   SELECT e.id,s.revision,s.control_epoch,seat.chip_count INTO STRICT next_entry,next_revision,next_epoch,next_stack
   FROM public.tournament_entries e JOIN public.tournament_seats seat ON seat.entry_id=e.id AND seat.is_active
   JOIN public.table_sessions s ON s.id=seat.table_session_id WHERE e.tournament_id=final AND e.player_id=players[i];
   PERFORM set_config('role','authenticated',true);
   result:=public.floor_bust_player_v3(next_entry,next_revision,next_epoch,next_stack,gen_random_uuid(),'Early1164 final field TEST');
   ASSERT result->>'ok'='true',result::text;
   order_ids:=array_prepend(next_entry,order_ids);
   IF i=7 AND to_regprocedure('private.multi_day_individual_close_state_v1(uuid)') IS NOT NULL THEN
    PERFORM set_config('role','none',true);
    ASSERT private.multi_day_individual_close_state_v1(final)->>'status'='individual_results_confirmation_required';
    ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=final AND finished_place IS NOT NULL);
    PERFORM set_config('role','authenticated',true);
   END IF;
   context:=public.get_multi_day_individual_rank_review_v1(event);
   result:=public.confirm_multi_day_individual_ranks_v1(event,context->>'sourceHash',order_ids,gen_random_uuid());
   ASSERT result->>'ok'='true',result::text;
   PERFORM set_config('role','none',true);
  END LOOP;
  -- Explicit legacy/manual fixture: counts were recorded without history. Turn
  -- history on for official close; immutable operator-confirmed ranks are the
  -- evidence. Never fill synthetic bust_order values to make finalizer pass.
  INSERT INTO public.club_settings(club_id,player_history_enabled,auto_swing_enabled)
   VALUES(club,true,false) ON CONFLICT(club_id) DO UPDATE SET player_history_enabled=true;
  ASSERT (SELECT count(*)=7 FROM private.multi_day_individual_results_v1 WHERE event_id=event);
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=final AND finished_place IS NOT NULL);
  SELECT e.id,seat.chip_count,s.revision,s.control_epoch INTO STRICT winner
  FROM public.tournament_entries e JOIN public.tournament_seats seat ON seat.entry_id=e.id AND seat.is_active
  JOIN public.table_sessions s ON s.id=seat.table_session_id WHERE e.tournament_id=final AND e.status<>'busted';
  PERFORM set_config('role','authenticated',true);
  result:=public.floor_free_sit_player_v1(winner.id,winner.revision,winner.control_epoch,winner.chip_count,gen_random_uuid(),'Early1164 winner leaves seat TEST');
  ASSERT result->>'ok'='true',result::text;
  PERFORM set_config('role','none',true);
  FOR closing_table IN SELECT t.id,s.revision FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
   WHERE t.tournament_id=final AND t.status='active' ORDER BY t.id LOOP
   PERFORM set_config('role','authenticated',true);
   result:=public.close_tournament_table_v4(closing_table.id,closing_table.revision,gen_random_uuid());ASSERT result->>'ok'='true',result::text;
   PERFORM set_config('role','none',true);
  END LOOP;
  SELECT md5(jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.cashier_buyin_movements x WHERE tournament_id=ANY(flights||ARRAY[final])),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_chip_counts x WHERE tournament_id=final),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_prize_payments x WHERE tournament_id=final))::text) INTO money_before;
  PERFORM set_config('role','authenticated',true);
  result:=public.close_tournament(final,'Early1164 canonical official close TEST');
  RAISE NOTICE '1164 finalizer response: %',result;
  ASSERT result->>'ok'='true','individual ranks did not finalize: '||result::text;
  close_id:=(result->>'report_id')::uuid;ASSERT close_id IS NOT NULL;
  PERFORM set_config('role','none',true);
  ASSERT floor_private.felt_official_results_close_status_v1(final)->>'status'='preserved';
  ASSERT (SELECT count(*)=8 AND count(DISTINCT finished_place)=8 AND min(finished_place)=1 AND max(finished_place)=8
   FROM public.tournament_entries WHERE tournament_id=final);
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1 f JOIN public.tournament_entries e ON e.id=f.entry_id
   WHERE f.event_id=event AND e.finished_place IS DISTINCT FROM f.finished_place);
  SELECT md5(jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.cashier_buyin_movements x WHERE tournament_id=ANY(flights||ARRAY[final])),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_chip_counts x WHERE tournament_id=final),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_prize_payments x WHERE tournament_id=final))::text) INTO money_after;
  ASSERT money_before=money_after,'finalizing individual ranks changed money/chip facts';
  PERFORM set_config('role','authenticated',true);
  result:=public.close_tournament(final,'Early1164 close replay TEST');
  ASSERT result->>'ok'='true' AND (result->>'report_id')::uuid=close_id,result::text;
  PERFORM set_config('test.early1164',jsonb_build_object('officialRanks',8,'individualRanks',7,'survivors',1,
   'closeReportId',close_id,'closeReplaySameReport',true,'moneyChipHashUnchanged',true,'paymentExecution','NOT_PERFORMED',
   'reportEntryCount',(SELECT entry_count FROM public.tournament_close_report WHERE id=close_id),
   'officialCloseStatus',(SELECT detail->'official_results'->>'status' FROM public.tournament_close_report WHERE id=close_id))::text,true);
  RAISE NOTICE 'EARLYITM1164_INDIVIDUAL_RANKS_FINALIZED_WITHOUT_RERANK_OR_MONEY_CHANGE';
 END;
