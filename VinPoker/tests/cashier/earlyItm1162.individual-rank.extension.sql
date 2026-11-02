 state:=public.get_multi_day_individual_rank_review_v1(event);
 RAISE NOTICE '1162 ranking readiness: %',(state->'ranking')-'entries'-'simultaneousGroups';
 keys:=ARRAY[gen_random_uuid()];
 BEGIN
  PERFORM public.confirm_multi_day_individual_ranks_v1(event,md5('wrong source'),ARRAY[seeded_entry],keys[1]);
  RAISE EXCEPTION 'stale source accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_rank_source_changed' THEN RAISE;END IF;END;
 BEGIN
  PERFORM public.confirm_multi_day_individual_ranks_v1(event,state->>'sourceHash',ARRAY[seeded_entry,seeded_entry],keys[1]);
  RAISE EXCEPTION 'duplicate entries accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_rank_entries_mismatch' THEN RAISE;END IF;END;
 recorded:=public.confirm_multi_day_individual_ranks_v1(event,state->>'sourceHash',ARRAY[seeded_entry],keys[1]);
 ASSERT recorded->>'ok'='true' AND recorded->>'paymentExecution'='NOT_PERFORMED',recorded::text;
 ASSERT recorded->'individualResults'->0->>'entry_id'=seeded_entry::text;
 ASSERT (recorded->'individualResults'->0->>'finished_place')::integer=8;
 ASSERT public.confirm_multi_day_individual_ranks_v1(event,state->>'sourceHash',ARRAY[seeded_entry],keys[1])=recorded;
 ASSERT public.get_multi_day_individual_rank_receipt_v1(event,keys[1])->'receipt'=recorded;
 BEGIN
  PERFORM public.confirm_multi_day_individual_ranks_v1(event,md5('changed payload'),ARRAY[seeded_entry],keys[1]);
  RAISE EXCEPTION 'changed request accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'IDEMPOTENCY_CONFLICT' THEN RAISE;END IF;END;
 PERFORM set_config('role','none',true);
 BEGIN
  UPDATE public.tournament_entries SET status='seated' WHERE id=seeded_entry;
  RAISE EXCEPTION 'finalized rank restored';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_result_immutable' THEN RAISE;END IF;END;
 BEGIN
  UPDATE public.tournament_entries SET finished_place=2 WHERE id=seeded_entry;
  RAISE EXCEPTION 'finalized rank changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_result_immutable' THEN RAISE;END IF;END;
 BEGIN
  UPDATE private.multi_day_individual_results_v1 SET finished_place=2 WHERE entry_id=seeded_entry;
  RAISE EXCEPTION 'snapshot changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'multi_day_qualification_immutable' THEN RAISE;END IF;END;
 ASSERT (SELECT count(*)=1 FROM private.multi_day_individual_results_v1 WHERE event_id=event);
 PERFORM set_config('test.early1162',jsonb_build_object('rank',8,'confirmedEntry',seeded_entry,'requestId',keys[1],
  'frozenRows',1,'officialEntryRankWritten',false,'paymentExecution','NOT_PERFORMED',
  'sourceHash',state->>'sourceHash','receiptOutcome',recorded->>'outcome')::text,true);
 PERFORM set_config('role','authenticated',true);
 RAISE NOTICE 'EARLYITM1162_INDIVIDUAL_RANK8_CONFIRMED_REPLAY_RECOVERY_RESTORE_RERANK_DENIED_NOT_PAYMENT_PASS';
