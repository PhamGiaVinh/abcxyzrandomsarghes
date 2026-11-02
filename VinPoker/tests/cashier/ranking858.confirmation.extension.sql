-- In-memory extension of857, under the same outer ROLLBACK and isolated seeds.
UPDATE public.tournament_hands SET status='completed'
 WHERE id='fa857000-0000-4000-8000-000000000003';
DO $$ DECLARE r jsonb;BEGIN
 r:=public.finalize_tournament_results('fa857000-0000-4000-8000-000000000002');
 ASSERT r->>'ok'='false' AND r->>'error'='manual_ranking_review_required',r::text;
 ASSERT floor_private.felt_official_results_close_status_v1('fa857000-0000-4000-8000-000000000002')->>'status'='manual_ranking_review_required';
END $$;
SAVEPOINT before_review;
SET LOCAL ROLE authenticated;
SELECT public.get_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002')->'source'->>'sourceHash' AS rank858_hash
\gset
SELECT set_config('test.rank858_hash',:'rank858_hash',true);
DO $$ DECLARE r jsonb;bad jsonb;ids uuid[];BEGIN
 r:=public.get_tournament_ranking_review_receipt_v1('fa857000-0000-4000-8000-000000000002',
 'fa858000-0000-4000-8000-000000000001','fa857000-0000-4000-8000-000000000010');
 ASSERT r->>'ok'='true' AND r->>'outcome'='not_found' AND r->'review'='null'::jsonb AND r->>'sourceCurrent'='false';
 FOR bad IN SELECT value FROM jsonb_array_elements('[
 ["fa857000-0000-4000-8000-000000000023","fa857000-0000-4000-8000-000000000021","fa857000-0000-4000-8000-000000000021","fa857000-0000-4000-8000-000000000024"],
 ["fa857000-0000-4000-8000-000000000023","fa857000-0000-4000-8000-000000000021","fa857000-0000-4000-8000-000000000022"],
 ["fa857000-0000-4000-8000-000000000021","fa857000-0000-4000-8000-000000000023","fa857000-0000-4000-8000-000000000022","fa857000-0000-4000-8000-000000000024"]]'::jsonb)
 LOOP
  SELECT array_agg(x::uuid) INTO ids FROM jsonb_array_elements_text(bad) AS j(x);
  BEGIN
   PERFORM public.confirm_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002',current_setting('test.rank858_hash'),
    ids,gen_random_uuid(),'fa857000-0000-4000-8000-000000000010');
   RAISE EXCEPTION 'ranking859_invalid_order_accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ranking_review_invalid_order' THEN RAISE;END IF;END;
 END LOOP;
END $$;
DO $$ DECLARE r jsonb;replay jsonb;order_ids uuid[]:=ARRAY[
 'fa857000-0000-4000-8000-000000000023','fa857000-0000-4000-8000-000000000022','fa857000-0000-4000-8000-000000000021','fa857000-0000-4000-8000-000000000024']::uuid[];
BEGIN
 r:=public.confirm_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002',current_setting('test.rank858_hash'),
 order_ids,'fa858000-0000-4000-8000-000000000001','fa857000-0000-4000-8000-000000000010');
 ASSERT r->>'ok'='true' AND r->>'outcome'='recorded';
 replay:=public.confirm_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002',current_setting('test.rank858_hash'),
 order_ids,'fa858000-0000-4000-8000-000000000001','fa857000-0000-4000-8000-000000000010');
 ASSERT replay=r,'ranking858_replay_changed_receipt';
 ASSERT (public.get_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002')->'review')=r->'review';
 BEGIN
  PERFORM public.confirm_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002',current_setting('test.rank858_hash'),
  ARRAY[order_ids[1],order_ids[3],order_ids[2],order_ids[4]],'fa858000-0000-4000-8000-000000000001','fa857000-0000-4000-8000-000000000010');
  RAISE EXCEPTION 'ranking858_conflict_was_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'IDEMPOTENCY_CONFLICT' THEN RAISE;END IF;END;
END $$;
SAVEPOINT after_review;
RESET ROLE;
UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id='fa857000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 r:=public.get_tournament_ranking_review_receipt_v1('fa857000-0000-4000-8000-000000000002',
  'fa858000-0000-4000-8000-000000000001','fa857000-0000-4000-8000-000000000010');
 ASSERT r->>'ok'='true' AND r->>'outcome'='recorded' AND r->>'sourceCurrent'='false';
 ASSERT r->'review'->>'source_hash'=current_setting('test.rank858_hash');
 ASSERT public.get_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002')->'review'='null'::jsonb;
END $$;
RESET ROLE;
DO $$ DECLARE r jsonb;BEGIN
 r:=public.finalize_tournament_results('fa857000-0000-4000-8000-000000000002');
 ASSERT r->>'ok'='false' AND r->>'error'='manual_ranking_review_required',r::text;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='fa857000-0000-4000-8000-000000000002' AND finished_place IS NOT NULL);
END $$;
ROLLBACK TO after_review;
RESET ROLE;
DO $$ DECLARE r jsonb;BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='fa857000-0000-4000-8000-000000000002' AND finished_place IS NOT NULL),
 'ranking858_confirmation_must_not_finalize_early';
 r:=public.finalize_tournament_results('fa857000-0000-4000-8000-000000000002');
 ASSERT r->>'ok'='true' AND r->>'ranking_review'='true',r::text;
 ASSERT (SELECT jsonb_object_agg(right(player_id::text,2),finished_place)='{"11":3,"12":2,"13":1,"14":4}'::jsonb
 FROM public.tournament_entries WHERE tournament_id='fa857000-0000-4000-8000-000000000002'),'ranking858_floor_order_not_applied';
END $$;
SELECT 'RANK858_FIRST_EXPLICIT_ORDER_REPLAY_CONFLICT_AND_NATIVE_FINALIZER_PASS';
ROLLBACK TO before_review;
-- A new source revision must refuse a previously rendered confirmation.
UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id='fa857000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('test.rank858_old_hash',:'rank858_hash',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.confirm_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002',current_setting('test.rank858_old_hash'),
   ARRAY['fa857000-0000-4000-8000-000000000023','fa857000-0000-4000-8000-000000000021','fa857000-0000-4000-8000-000000000022','fa857000-0000-4000-8000-000000000024']::uuid[],
   'fa858000-0000-4000-8000-000000000002','fa857000-0000-4000-8000-000000000010');
  RAISE EXCEPTION 'ranking858_stale_source_was_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ranking_review_source_changed' THEN RAISE;END IF;END;
END $$;
ROLLBACK TO before_review;
SET LOCAL ROLE authenticated;
SELECT set_config('test.rank858_hash',:'rank858_hash',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.confirm_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002',current_setting('test.rank858_hash'),
   ARRAY['fa857000-0000-4000-8000-000000000023','fa857000-0000-4000-8000-000000000024','fa857000-0000-4000-8000-000000000021','fa857000-0000-4000-8000-000000000022']::uuid[],
   'fa858000-0000-4000-8000-000000000004','fa857000-0000-4000-8000-000000000010');
  RAISE EXCEPTION 'ranking858_unrelated_elimination_moved';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ranking_review_unrelated_place_changed' THEN RAISE;END IF;END;
END $$;
SELECT public.confirm_tournament_ranking_review_v1('fa857000-0000-4000-8000-000000000002',:'rank858_hash',
 ARRAY['fa857000-0000-4000-8000-000000000023','fa857000-0000-4000-8000-000000000021','fa857000-0000-4000-8000-000000000022','fa857000-0000-4000-8000-000000000024']::uuid[],
 'fa858000-0000-4000-8000-000000000003','fa857000-0000-4000-8000-000000000010')->>'ok';
RESET ROLE;
DO $$ DECLARE r jsonb;BEGIN
 r:=public.finalize_tournament_results('fa857000-0000-4000-8000-000000000002');
 ASSERT r->>'ok'='true' AND r->>'ranking_review'='true',r::text;
 ASSERT (SELECT jsonb_object_agg(right(player_id::text,2),finished_place)='{"11":2,"12":3,"13":1,"14":4}'::jsonb
 FROM public.tournament_entries WHERE tournament_id='fa857000-0000-4000-8000-000000000002'),'ranking858_second_floor_order_not_applied';
END $$;
SELECT 'RANK858_SECOND_EXPLICIT_ORDER_AND_STALE_SOURCE_PASS';
