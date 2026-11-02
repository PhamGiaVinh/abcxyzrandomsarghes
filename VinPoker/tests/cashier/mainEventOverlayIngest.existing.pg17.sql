-- LOCAL provider-input fixture: canonical ingest -> canonical overlay. ROLLBACK all.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_port()=55441;
 ASSERT (SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron'))=0;
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1
   WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'),'pre-funding fixture is stage-stale; do not reset retained journey';
 ASSERT NOT EXISTS(SELECT 1 FROM public.platform_bank_accounts WHERE account_number='TEST-GTD215-NOT-REAL');
 ASSERT NOT EXISTS(SELECT 1 FROM public.bank_transactions WHERE provider_txn_id='LOCAL_SIMULATED_GTD215_NOT_REAL');
END $$;
INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,notes)
VALUES('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','LOCAL MODEL ONLY','TEST-GTD215-NOT-REAL',
 'NO REAL ACCOUNT','LOCAL simulated provider input; no external transfer');
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT public.sepay_ingest_verified_transactions('[{"provider_txn_id":"LOCAL_SIMULATED_GTD215_NOT_REAL",
 "account_number":"TEST-GTD215-NOT-REAL","amount":900000,"transfer_type":"in",
 "content":"LOCAL simulated club GTD funding","occurred_at":"2026-10-21T00:00:00+07:00",
 "raw_payload":{"localSimulation":true,"externalTransfer":false}}]'::jsonb);
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.bank_transactions WHERE provider_txn_id='LOCAL_SIMULATED_GTD215_NOT_REAL'
   AND club_id IS NULL AND api_verified_at IS NOT NULL AND status='unmatched');
END $$;
SELECT set_config('test.gtd215_bank',(SELECT id::text FROM public.bank_transactions
 WHERE provider_txn_id='LOCAL_SIMULATED_GTD215_NOT_REAL'),true);
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL request.jwt.claim.role='authenticated';
DO $negative$
DECLARE scenario text; rejected boolean;
BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id='12ac8914-4a94-4f29-99d6-a74a506c134e');
 FOREACH scenario IN ARRAY ARRAY['ambiguous-account','inactive-account','foreign-account',
   'foreign-bank','unverified','outgoing','overspend','outsider'] LOOP
  BEGIN
   CASE scenario
    WHEN 'ambiguous-account' THEN
     INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder)
     VALUES('12ac8914-4a94-4f29-99d6-a74a506c134e','LOCAL MODEL','TEST-GTD215-NOT-REAL','NO REAL ACCOUNT');
    WHEN 'inactive-account' THEN
     UPDATE public.platform_bank_accounts SET is_active=false WHERE account_number='TEST-GTD215-NOT-REAL';
    WHEN 'foreign-account' THEN
     UPDATE public.platform_bank_accounts SET club_id='12ac8914-4a94-4f29-99d6-a74a506c134e'
      WHERE account_number='TEST-GTD215-NOT-REAL';
    WHEN 'foreign-bank' THEN
     UPDATE public.bank_transactions SET club_id='12ac8914-4a94-4f29-99d6-a74a506c134e'
      WHERE id=current_setting('test.gtd215_bank')::uuid;
    WHEN 'unverified' THEN
     UPDATE public.bank_transactions SET api_verified_at=NULL WHERE id=current_setting('test.gtd215_bank')::uuid;
    WHEN 'outgoing' THEN
     UPDATE public.bank_transactions SET transfer_type='out' WHERE id=current_setting('test.gtd215_bank')::uuid;
    WHEN 'outsider' THEN
     PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
    ELSE NULL;
   END CASE;
   rejected:=false;
   BEGIN
    PERFORM public.multi_day_record_overlay_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d','RECORDED',
      CASE WHEN scenario='overspend' THEN 900001 ELSE 900000 END,
      'LOCAL_SIMULATED_GTD215_NOT_REAL','TEST club funds full GTD; provider modeled, no transfer',NULL,NULL,
      '5417e359-7142-4daa-aa30-ab0683b3e215',current_setting('test.gtd215_bank')::uuid);
   EXCEPTION WHEN check_violation OR insufficient_privilege THEN
    ASSERT SQLERRM=CASE WHEN scenario='outsider' THEN 'multi_day_overlay_owner_required'
      ELSE 'multi_day_overlay_bank_unverified_or_allocated' END;
    rejected:=true;
   END;
   ASSERT rejected,format('unsafe overlay accepted: %s',scenario);
   ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1
     WHERE request_id='5417e359-7142-4daa-aa30-ab0683b3e215');
   RAISE EXCEPTION USING ERRCODE='ZX215',MESSAGE='rollback negative fixture';
  EXCEPTION WHEN SQLSTATE 'ZX215' THEN NULL; END;
  ASSERT EXISTS(SELECT 1 FROM public.bank_transactions WHERE id=current_setting('test.gtd215_bank')::uuid
    AND club_id IS NULL AND status='unmatched');
 END LOOP;
 RAISE NOTICE 'OVERLAY_BINDING_AMBIGUITY_TENANT_OWNER_VERIFICATION_AMOUNT_NEGATIVES_PASS';
END $negative$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb; replay jsonb;
BEGIN
 r:=public.multi_day_record_overlay_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d','RECORDED',900000,
   'LOCAL_SIMULATED_GTD215_NOT_REAL','TEST club funds full GTD; provider modeled, no transfer',NULL,NULL,
   '5417e359-7142-4daa-aa30-ab0683b3e215',current_setting('test.gtd215_bank')::uuid);
 ASSERT r->>'ok'='true' AND r->>'idempotent'='false';
 replay:=public.multi_day_record_overlay_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d','RECORDED',900000,
   'LOCAL_SIMULATED_GTD215_NOT_REAL','TEST club funds full GTD; provider modeled, no transfer',NULL,NULL,
   '5417e359-7142-4daa-aa30-ab0683b3e215',current_setting('test.gtd215_bank')::uuid);
 ASSERT replay->>'idempotent'='true' AND replay->>'recordId'=r->>'recordId';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.bank_transactions WHERE id=current_setting('test.gtd215_bank')::uuid
   AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND status='matched');
 ASSERT (SELECT count(*) FROM public.multi_day_overlay_funding_v1
   WHERE request_id='5417e359-7142-4daa-aa30-ab0683b3e215' AND amount_vnd=900000)=1;
 RAISE NOTICE 'CANONICAL_INGEST_UNBOUND_CLUB_TO_AUDITED_OVERLAY_REPLAY_PASS';
END $$;
ROLLBACK;
