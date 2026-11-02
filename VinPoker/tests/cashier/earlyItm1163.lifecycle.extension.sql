 -- Run after1162 has frozen rank8. All native writes remain in outerROLLBACK.
 DECLARE target record; wrapper text; before_restore text; before_frozen jsonb;
 second_entry uuid;second_revision bigint;second_epoch bigint;second_stack integer;
 new_state jsonb;new_receipt jsonb;request2 uuid:=gen_random_uuid();
 BEGIN
  PERFORM set_config('role','none',true);
  SELECT t.id,s.revision,s.control_epoch,n.seat INTO STRICT target
  FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
  CROSS JOIN LATERAL(SELECT n AS seat FROM generate_series(1,9)n WHERE NOT EXISTS(
   SELECT 1 FROM public.tournament_seats occupied WHERE occupied.tournament_table_id=t.id
    AND occupied.is_active AND occupied.seat_number=n) ORDER BY n LIMIT 1)n
  WHERE t.id=selected[1];
  before_restore:=pg_temp.d2_789_fingerprint();
  FOREACH wrapper IN ARRAY ARRAY['floor_restore_busted_player_to_seat_v3','floor_restore_busted_player_to_seat_v4'] LOOP
   BEGIN
    PERFORM set_config('role','authenticated',true);
    EXECUTE format('SELECT public.%I($1,$2,$3,$4,$5,$6)',wrapper)
     INTO new_receipt USING seeded_entry,target.id,target.seat,target.revision,target.control_epoch,gen_random_uuid();
    RAISE EXCEPTION 'frozen canonical restore not rejected by invariant: % %',wrapper,new_receipt;
   EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'individual_result_immutable' THEN RAISE;END IF;
   END;
  END LOOP;
  PERFORM set_config('role','none',true);
  ASSERT pg_temp.d2_789_fingerprint()=before_restore,'denied restore leaked a seat/revision/receipt';
  SELECT to_jsonb(x) INTO STRICT before_frozen FROM private.multi_day_individual_results_v1 x WHERE entry_id=seeded_entry;
  SELECT e.id,s.revision,s.control_epoch,seat.chip_count INTO STRICT second_entry,second_revision,second_epoch,second_stack
  FROM public.tournament_entries e JOIN public.tournament_seats seat ON seat.entry_id=e.id AND seat.is_active
  JOIN public.table_sessions s ON s.id=seat.table_session_id WHERE e.tournament_id=final AND e.player_id=players[2];
  PERFORM set_config('role','authenticated',true);
  new_receipt:=public.floor_bust_player_v3(second_entry,second_revision,second_epoch,second_stack,gen_random_uuid(),'Early1163 second canonical bust TEST');
  ASSERT new_receipt->>'ok'='true',new_receipt::text;
  new_state:=public.get_multi_day_individual_rank_review_v1(event);
  ASSERT (new_state->'ranking'->>'survivors')::integer=6;
  BEGIN
   PERFORM public.confirm_multi_day_individual_ranks_v1(event,new_state->>'sourceHash',ARRAY[seeded_entry,second_entry],request2);
   RAISE EXCEPTION 'existing rank8 reordered as rank7';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_rank_frozen_conflict' THEN RAISE;END IF;END;
  new_receipt:=public.confirm_multi_day_individual_ranks_v1(event,new_state->>'sourceHash',ARRAY[second_entry,seeded_entry],request2);
  ASSERT jsonb_array_length(new_receipt->'individualResults')=2;
  ASSERT public.get_multi_day_individual_rank_receipt_v1(event,keys[1])->'receipt'=recorded,'old receipt changed with later source';
  ASSERT public.confirm_multi_day_individual_ranks_v1(event,state->>'sourceHash',ARRAY[seeded_entry],keys[1])=recorded,'old replay changed after later bust';
  PERFORM set_config('role','none',true);
  ASSERT (SELECT to_jsonb(x)=before_frozen FROM private.multi_day_individual_results_v1 x WHERE entry_id=seeded_entry);
  ASSERT (SELECT finished_place=7 FROM private.multi_day_individual_results_v1 WHERE entry_id=second_entry);
  ASSERT (SELECT count(*)=2 FROM private.multi_day_individual_rank_requests_v1 WHERE event_id=event);
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=final);
  PERFORM set_config('test.early1163',jsonb_build_object('frozenRanks',jsonb_build_array(7,8),'survivors',6,
   'canonicalRestoreV3V4Rejected',true,'restoreProtectedFactsUnchanged',true,'firstFrozenRowUnchanged',true,
   'originalReceiptAndReplayUnchanged',true,'payments',0)::text,true);
  PERFORM set_config('role','authenticated',true);
  RAISE NOTICE 'EARLYITM1163_CANONICAL_RESTORE_V3_V4_DENIED_SECOND_BUST_RANK7_PRESERVES8_NO_PAYMENT';
 END;
