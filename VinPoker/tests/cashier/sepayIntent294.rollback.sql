-- Run after candidate225 with its final COMMIT removed; everything rolls back.
-- No provider calls, paid registrations, retained bank rows or ledger edits.
CREATE FUNCTION pg_temp.assert294(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL294:%',label; END IF; END $$;
CREATE TEMP TABLE baseline294 AS SELECT
 (SELECT count(*) FROM public.bank_transactions) banks,
 (SELECT count(*) FROM public.payment_settlements) settlements,
 (SELECT count(*) FROM public.ops_cashier_mutation_idempotency) receipts;
SELECT pg_temp.assert294(
 NOT has_function_privilege('anon','public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)','EXECUTE')
 AND has_function_privilege('authenticated','public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)','EXECUTE'), 'function ACL');
INSERT INTO public.bank_transactions(id,provider_txn_id,account_number,club_id,amount,content)
VALUES('e2940000-0000-4000-8000-000000000001','LOCAL-ROLLBACK294','TEST-NON-BANK-294',
 'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',1000,'LOCAL rollback only');
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
SELECT pg_temp.assert294(public.cashier_sepay_intent_v1('receipt','ignore','e2940000-0000-4000-8000-000000000001',NULL,NULL,'e2940000-0000-4000-8000-000000000010')->>'error'='unauthorized','no actor');
SELECT set_config('request.jwt.claim.sub','e2940000-0000-4000-8000-000000000099',true),
 set_config('request.jwt.claims','{"sub":"e2940000-0000-4000-8000-000000000099","role":"authenticated"}',true);
SELECT pg_temp.assert294(public.cashier_sepay_intent_v1('commit','ignore','e2940000-0000-4000-8000-000000000001',NULL,NULL,'e2940000-0000-4000-8000-000000000010')->>'error'='actor_not_allowed','outsider');
SELECT set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true),
 set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
DO $$ DECLARE malformed jsonb; BEGIN
 FOREACH malformed IN ARRAY ARRAY['[]'::jsonb,'1'::jsonb,'null'::jsonb,'{}'::jsonb,
  '{"bank_amount":"1000","total_pay":null}'::jsonb,'{"bank_amount":1e100,"total_pay":null}'::jsonb,
  '{"bank_amount":1.5,"total_pay":null}'::jsonb,'{"bank_amount":1000,"total_pay":-1}'::jsonb,
  '{"bank_amount":1000,"total_pay":null,"extra":true}'::jsonb] LOOP
  PERFORM pg_temp.assert294(public.cashier_sepay_intent_v1('commit','ignore',
   'e2940000-0000-4000-8000-000000000001',NULL,NULL,gen_random_uuid(),malformed)->>'error'='invalid_sepay_snapshot','malformed snapshot rejected without exception');
 END LOOP;
END $$;
SELECT pg_temp.assert294(public.cashier_sepay_intent_v1('receipt','confirm','e2940000-0000-4000-8000-000000000001',NULL,NULL,'e2940000-0000-4000-8000-000000000010')->>'error'='invalid_sepay_intent','confirm missing registration');
SELECT pg_temp.assert294(public.cashier_sepay_intent_v1('receipt','ignore','e2940000-0000-4000-8000-000000000001',NULL,'reason','e2940000-0000-4000-8000-000000000010')->>'status'='receipt_not_found','receipt lookup does not commit');
SELECT pg_temp.assert294(public.cashier_sepay_intent_v1('commit','ignore','e2940000-0000-4000-8000-000000000001',NULL,' reason ','e2940000-0000-4000-8000-000000000010','{"bank_amount":1000,"total_pay":null}'::jsonb) #>> '{receipt,outcome}'='dismissed','actual ignore commit');
SELECT pg_temp.assert294((public.cashier_sepay_intent_v1('commit','ignore','e2940000-0000-4000-8000-000000000001',NULL,'reason','e2940000-0000-4000-8000-000000000010','{"bank_amount":1000,"total_pay":null}'::jsonb)->>'replayed')::boolean,'same key normalized payload replay');
SELECT pg_temp.assert294(public.cashier_sepay_intent_v1('receipt','ignore','e2940000-0000-4000-8000-000000000001',NULL,'reason','e2940000-0000-4000-8000-000000000010','{"bank_amount":1000,"total_pay":null}'::jsonb) #>> '{receipt,outcome}'='dismissed','lost response receipt');
SELECT pg_temp.assert294(public.cashier_sepay_intent_v1('commit','ignore','e2940000-0000-4000-8000-000000000001',NULL,'different','e2940000-0000-4000-8000-000000000010','{"bank_amount":1000,"total_pay":null}'::jsonb)->>'error'='request_payload_conflict','same key different payload');
RESET ROLE;
SELECT pg_temp.assert294((SELECT count(*)=1 FROM public.payment_settlements WHERE bank_transaction_id='e2940000-0000-4000-8000-000000000001'),'one settlement only');
SELECT pg_temp.assert294((SELECT count(*)=1 FROM public.ops_cashier_mutation_idempotency WHERE idempotency_key='sepay:v1:675fe35e-60a8-4452-bb90-e79486d54da6:e2940000-0000-4000-8000-000000000010'),'one receipt only');
-- Inject a receipt failure after the actual old writer: subtransaction must undo both.
INSERT INTO public.bank_transactions(id,provider_txn_id,account_number,club_id,amount)
VALUES('e2940000-0000-4000-8000-000000000002','LOCAL-ROLLBACK294-FAULT','TEST-NON-BANK-294',
 'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',1000);
CREATE FUNCTION pg_temp.reject_receipt294() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.idempotency_key='sepay:v1:675fe35e-60a8-4452-bb90-e79486d54da6:e2940000-0000-4000-8000-000000000020' THEN
 RAISE EXCEPTION 'injected294'; END IF; RETURN NEW; END $$;
CREATE TRIGGER reject_receipt294 BEFORE INSERT ON public.ops_cashier_mutation_idempotency FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_receipt294();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.cashier_sepay_intent_v1('commit','ignore','e2940000-0000-4000-8000-000000000002',NULL,NULL,'e2940000-0000-4000-8000-000000000020');
  RAISE EXCEPTION 'expected injected receipt failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected294' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert294((SELECT status='unmatched' FROM public.bank_transactions WHERE id='e2940000-0000-4000-8000-000000000002')
 AND NOT EXISTS(SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id='e2940000-0000-4000-8000-000000000002')
 AND NOT EXISTS(SELECT 1 FROM public.ops_cashier_mutation_idempotency WHERE idempotency_key LIKE '%e2940000-0000-4000-8000-000000000020'),'writer and receipt atomic rollback');
SELECT 'SEPAY294_IGNORE_ROLLBACK_PASS_NOT_FULL_CONFIRM_OR_CONCURRENCY';
ROLLBACK;
