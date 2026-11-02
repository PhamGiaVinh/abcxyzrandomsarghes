\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='completed' AND registration_closed_at IS NULL AND prize_pool=0);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_close_report WHERE id='95fc8d98-a056-45f2-9803-d505a58c686e' AND detail->'official_results'->>'status'='finalized');
END $$;
CREATE TEMP TABLE single698_before ON COMMIT DROP AS
SELECT md5(jsonb_build_array(
 (SELECT to_jsonb(t) FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e'),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prize_payments r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_close_report r))::text) fingerprint;
SAVEPOINT draft_review;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE prepared jsonb; frozen jsonb; resumed jsonb; BEGIN
 prepared:=public.prepare_payout_snapshot('c367013a-3ed3-48af-ad48-3915acadc50e',0.15,'DAILY',2,100000,NULL,NULL,false,NULL,NULL);
 ASSERT prepared->>'status'='prepared';
 -- Exact same authenticated read used by the new review/revalidation UI.
 SELECT to_jsonb(r) INTO STRICT frozen FROM public.tournament_payout_runs r
 WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='draft_snapshot';
 ASSERT frozen->>'id'=prepared->>'run_id' AND frozen->>'entries_snapshot'='9'
  AND frozen->>'buy_in_snapshot'='100000' AND frozen->>'rake_snapshot'='0'
  AND frozen->>'prize_pool_snapshot'='900000' AND frozen->>'effective_floor'='200000'
  AND (frozen->>'itm_percent')::numeric=0.15 AND frozen->>'archetype'='DAILY'
  AND (frozen->>'min_cash_x')::numeric=2 AND frozen->>'rounding_unit'='100000'
  AND frozen->'custom_percents'='null'::jsonb;
 resumed:=public.prepare_payout_snapshot('c367013a-3ed3-48af-ad48-3915acadc50e',0.2,'MULTI',1.5,1000,NULL,NULL,false,NULL,NULL);
 ASSERT resumed->>'status'='resumed' AND resumed->>'run_id'=frozen->>'id';
 ASSERT (SELECT to_jsonb(r)=frozen FROM public.tournament_payout_runs r WHERE id=(frozen->>'id')::uuid);
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
END $$;
RESET ROLE;
ROLLBACK TO draft_review;
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM single698_before)=md5(jsonb_build_array(
 (SELECT to_jsonb(t) FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e'),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prize_payments r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_close_report r))::text);
END $$;
ROLLBACK;
SELECT 'SINGLE698_AUTHENTICATED_FULL_FROZEN_REVIEW_OTHER_CLUB_DENIED_CANONICAL_RESUME_UNCHANGED_ALL_ROLLBACK_PASS';
