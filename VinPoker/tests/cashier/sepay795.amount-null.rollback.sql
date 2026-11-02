-- Invalid provider amount stays unknown, never an inferred VND amount.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
END $$;
CREATE TEMP TABLE sepay795_before ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x)
)::text) fingerprint;
DO $$ DECLARE ref text:='LOCAL795-'||gen_random_uuid(); result jsonb; bank_row public.bank_transactions;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);
 ASSERT public.sepay_ingest_verified_transactions(jsonb_build_array(jsonb_build_object(
  'provider_txn_id',ref,'account_number','LOCAL795_UNCONFIGURED_ACCOUNT','amount',NULL,
  'transfer_type','in','content','LOCAL795_NO_REFERENCE','occurred_at','2026-10-19T03:00:00Z',
  'raw_payload',jsonb_build_object('id',ref,'amount_in','9007199254740993')
 )))=1;
 PERFORM set_config('role','none',true);
 ASSERT EXISTS(SELECT 1 FROM public.bank_transactions WHERE provider='sepay' AND provider_txn_id=ref
   AND account_number='LOCAL795_UNCONFIGURED_ACCOUNT' AND amount IS NULL
   AND raw_payload->>'amount_in'='9007199254740993');
 SELECT * INTO STRICT bank_row FROM public.bank_transactions WHERE provider='sepay' AND provider_txn_id=ref
  AND account_number='LOCAL795_UNCONFIGURED_ACCOUNT';
 PERFORM set_config('role','service_role',true);
 result:=public.settle_bank_transaction(bank_row.id,true);
 ASSERT result->>'ok'='true' AND result->>'skipped'='not_settleable_shape',result::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT fingerprint FROM sepay795_before)=md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x)
 )::text),'invalid amount changed paid entries or seating';
END $$;
ROLLBACK;
SELECT 'SEPAY795_NATIVE_NULL_AMOUNT_RAW_EVIDENCE_PRESERVED_NOT_SETTLEABLE_NO_CASH_ENTRY_SEAT_DELTA_ALL_ROLLBACK_PASS';
