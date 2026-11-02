-- ONE-TIME linked local journey checkpoint. External provider response MODELLED;
-- real SePay DB ingest and owner overlay RPC, no external transfer/payment.
-- Do not rerun after success: use the recorded request's canonical receipt.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'; ASSERT inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id
   WHERE e.id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND e.name='Main Event browser local TEST 164'
    AND e.guarantee_amount=2500000 AND e.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
    AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6');
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.multi_day_record_overlay_v1(uuid,text,bigint,text,text,uuid,uuid,uuid,uuid)'::regprocedure)='bd3b4be179df4f61a98e19148cb8aee7';
 ASSERT NOT EXISTS(SELECT 1 FROM public.bank_transactions WHERE provider_txn_id='LOCAL_MAIN_EVENT216_SIMULATED_OVERLAY900K');
 ASSERT NOT EXISTS(SELECT 1 FROM public.platform_bank_accounts WHERE account_number='TEST-MAIN-EVENT216-NOT-REAL');
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
END $$;
CREATE TEMP TABLE local216_gates ON COMMIT DROP AS SELECT * FROM public.multi_day_package_release_v1 WHERE id FOR UPDATE;
CREATE TEMP TABLE local216_auth ON COMMIT DROP AS SELECT has_schema_privilege('authenticated','auth','USAGE') prior;
CREATE TEMP TABLE local216_business_before ON COMMIT DROP AS SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r),
 'payments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prize_payments r),
 'prizes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r),
 'entries',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
 'seats',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_seats r WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')
)::text) hash;
INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,notes)
VALUES('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','LOCAL SIMULATED PROVIDER',
 'TEST-MAIN-EVENT216-NOT-REAL','NO REAL ACCOUNT',
 'Main Event local canary only; provider response simulated, no external transfer');
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT public.sepay_ingest_verified_transactions('[{"provider_txn_id":"LOCAL_MAIN_EVENT216_SIMULATED_OVERLAY900K",
 "account_number":"TEST-MAIN-EVENT216-NOT-REAL","amount":900000,"transfer_type":"in",
 "content":"LOCAL TEST club covers shared GTD; NOT real money",
 "occurred_at":"2026-10-21T00:00:00+07:00",
 "raw_payload":{"localSimulation":true,"externalTransfer":false,"eventId":"dbb49f8d-7d47-4c2c-afd9-f57062c9971d","purpose":"owner-approved TEST full shared GTD"}}]');
RESET ROLE;
SELECT set_config('test.local216_bank',(SELECT id::text FROM public.bank_transactions
 WHERE provider_txn_id='LOCAL_MAIN_EVENT216_SIMULATED_OVERLAY900K'),true);
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.bank_transactions WHERE id=current_setting('test.local216_bank')::uuid
   AND club_id IS NULL AND api_verified_at IS NOT NULL AND amount=900000 AND status='unmatched');
 IF NOT (SELECT prior FROM local216_auth) THEN GRANT USAGE ON SCHEMA auth TO authenticated; END IF;
END $$;
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT public.multi_day_record_overlay_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d','RECORDED',900000,
 'LOCAL_MAIN_EVENT216_SIMULATED_OVERLAY900K','LOCAL TEST club covers full GTD; provider modeled, no transfer',NULL,NULL,
 '9bbdcdb3-befe-41f0-9439-5601b4497216',current_setting('test.local216_bank')::uuid);
RESET ROLE;
UPDATE public.multi_day_package_release_v1 SET (enabled,allowed_club_ids,updated_at)=
 (SELECT enabled,allowed_club_ids,updated_at FROM local216_gates) WHERE id;
DO $$ BEGIN
 IF NOT (SELECT prior FROM local216_auth) THEN REVOKE USAGE ON SCHEMA auth FROM authenticated; END IF;
 ASSERT (SELECT to_jsonb(g) FROM public.multi_day_package_release_v1 g WHERE id)=(SELECT to_jsonb(g) FROM local216_gates g);
 ASSERT (SELECT hash FROM local216_business_before)=md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r),
 'payments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prize_payments r),
 'prizes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r),
 'entries',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
 'seats',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_seats r WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')
 )::text);
 ASSERT EXISTS(SELECT 1 FROM public.bank_transactions WHERE id=current_setting('test.local216_bank')::uuid
   AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND status='matched' AND raw_payload->>'localSimulation'='true');
 ASSERT (SELECT count(*) FROM public.multi_day_overlay_funding_v1 WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND amount_vnd=900000)=1;
 RAISE NOTICE 'LINKED_MAIN_EVENT_LOCAL_MODELED_PROVIDER_REAL_INGEST_OVERLAY900K_NO_PAYMENT_FLAGS_RESTORED';
END $$;
COMMIT;
