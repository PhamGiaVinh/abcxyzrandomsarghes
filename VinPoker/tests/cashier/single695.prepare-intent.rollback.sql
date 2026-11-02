\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='completed' AND registration_closed_at IS NULL AND prize_pool=0);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_close_report WHERE id='95fc8d98-a056-45f2-9803-d505a58c686e' AND detail->'official_results'->>'status'='finalized');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
END $$;
CREATE TEMP TABLE single695_before ON COMMIT DROP AS
SELECT md5(jsonb_build_array(
 (SELECT to_jsonb(t) FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e'),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prize_payments r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_close_report r))::text) fingerprint;
SAVEPOINT preset;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE original jsonb; resumed jsonb; BEGIN
 original:=public.prepare_payout_snapshot('c367013a-3ed3-48af-ad48-3915acadc50e',0.15,'DAILY',2,100000,NULL,NULL,false,NULL,NULL);
 ASSERT original->>'status'='prepared' AND original->>'entries_snapshot'='9' AND original->>'prize_pool_snapshot'='900000';
 resumed:=public.prepare_payout_snapshot('c367013a-3ed3-48af-ad48-3915acadc50e',0.2,'MULTI',1.5,1000,NULL,NULL,false,NULL,NULL);
 ASSERT resumed->>'status'='resumed' AND resumed->>'run_id'=original->>'run_id';
 ASSERT resumed->>'archetype'='DAILY' AND (resumed->>'itm_percent')::numeric=0.15
  AND (resumed->>'min_cash_x')::numeric=2 AND (resumed->>'rounding_unit')::bigint=100000;
 -- A changed UI confirmation must not silently compute this frozen old run.
END $$;
RESET ROLE;
ROLLBACK TO preset;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE original jsonb; resumed jsonb; frozen jsonb; BEGIN
 original:=public.prepare_payout_snapshot('c367013a-3ed3-48af-ad48-3915acadc50e',0.15,'CUSTOM',2,100000,NULL,NULL,false,NULL,
  '[{"position":1,"percent_bp":6000},{"position":2,"percent_bp":2500},{"position":3,"percent_bp":1500}]');
 ASSERT original->>'status'='prepared';
 resumed:=public.prepare_payout_snapshot('c367013a-3ed3-48af-ad48-3915acadc50e',0.15,'CUSTOM',2,100000,NULL,NULL,false,NULL,
  '[{"position":1,"percent_bp":5000},{"position":2,"percent_bp":3000},{"position":3,"percent_bp":2000}]');
 ASSERT resumed->>'status'='resumed' AND resumed->>'run_id'=original->>'run_id' AND resumed->>'archetype'='CUSTOM';
 ASSERT NOT(resumed?'custom_percents');
 SELECT custom_percents INTO STRICT frozen FROM public.tournament_payout_runs WHERE id=(resumed->>'run_id')::uuid AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='draft_snapshot';
 ASSERT frozen='[{"position":1,"percent_bp":6000},{"position":2,"percent_bp":2500},{"position":3,"percent_bp":1500}]'::jsonb;
 -- The authenticated frozen read is necessary: scalar echoes cannot prove the ladder.
END $$;
RESET ROLE;
ROLLBACK TO preset;
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM single695_before)=md5(jsonb_build_array(
 (SELECT to_jsonb(t) FROM public.tournaments t WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e'),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prize_payments r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_close_report r))::text);
END $$;
ROLLBACK;
SELECT 'SINGLE695_ACTUAL_PREPARE_RESUMES_FROZEN_DIFFERENT_INTENT_CUSTOM_READ_AUTHORIZED_ALL_BUSINESS_FACTS_ROLLBACK_PASS';
