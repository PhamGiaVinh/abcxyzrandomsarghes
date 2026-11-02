\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 ASSERT md5(pg_get_functiondef('public.settle_bank_transaction(uuid,boolean)'::regprocedure))='1fd77b3e02d0317c4a838aeef28646cf';
 ASSERT md5(pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure))='e882cbe4a609fb435b5f75d1e7ab0982';
 ASSERT has_function_privilege('service_role','public.settle_bank_transaction(uuid,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.settle_bank_transaction(uuid,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.settle_bank_transaction(uuid,boolean)','EXECUTE');
END $$;
-- FNB741_CANDIDATE
CREATE TEMP TABLE fnb741_original_core AS SELECT pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure) AS definition;
-- Fault injection is transaction-local. The settlement parent under test is real.
CREATE OR REPLACE FUNCTION public.fnb_settle_bank_paid(p_order_id uuid,p_bank_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fault$
BEGIN RAISE EXCEPTION 'LOCAL741_INJECTED_CORE_TECHNICAL_FAILURE' USING ERRCODE=current_setting('test.fnb741_fault'); END
$fault$;
DO $$ DECLARE f jsonb;bank uuid:=gen_random_uuid();account text;reference text;response jsonb;caught boolean:=false;fault text;actual_state text;
BEGIN
 SELECT fixture INTO STRICT f FROM floor_private.fnb720_fixture;
 ASSERT f->>'test_only'='true';
 SELECT account_number INTO STRICT account FROM public.bank_transactions WHERE id=(f->>'bank')::uuid AND account_number LIKE 'TEST-NON-BANK720-%';
 SELECT reference_code INTO STRICT reference FROM public.fnb_orders WHERE id=(f->>'order')::uuid AND status='pending' AND subtotal_vnd=5000;
 ASSERT (SELECT on_hand=10 FROM public.fnb_ingredients WHERE id=(f->>'ingredient')::uuid);
 ASSERT EXISTS(SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id=(f->>'bank')::uuid AND outcome='flagged_not_pending' AND reason LIKE 'column "old_status" is of type%');
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at)
 VALUES(bank,'sepay','LOCAL741-ROLLBACK-'||bank,account,(f->>'club')::uuid,5000,'in',reference,clock_timestamp());
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 FOREACH fault IN ARRAY ARRAY['22000','40001','40P01','42501'] LOOP
  caught:=false;response:=null;
  PERFORM set_config('test.fnb741_fault',fault,true);
  BEGIN
   PERFORM set_config('role','service_role',true);
   response:=public.settle_bank_transaction(bank,true);
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE;
   ASSERT actual_state=fault,'technical SQLSTATE changed';caught:=true;
  END;
  PERFORM set_config('role','none',true);
  ASSERT caught,'FNB741_TECHNICAL_ERROR_WAS_SWALLOWED_AS_TERMINAL: '||coalesce(response::text,'null');
  ASSERT NOT EXISTS(SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id=bank);
  ASSERT (SELECT status='unmatched' FROM public.bank_transactions WHERE id=bank);
  ASSERT (SELECT status='pending' FROM public.fnb_orders WHERE id=(f->>'order')::uuid);
  ASSERT (SELECT on_hand=10 FROM public.fnb_ingredients WHERE id=(f->>'ingredient')::uuid);
 END LOOP;
 -- Explicit business rejection remains terminal and cannot be silently auto-retried.
 BEGIN
  EXECUTE $stub$CREATE OR REPLACE FUNCTION public.fnb_settle_bank_paid(p_order_id uuid,p_bank_transaction_id uuid)
   RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $business$
   BEGIN RETURN '{"ok":false,"error":"order_not_pending"}'::jsonb; END $business$;$stub$;
  PERFORM set_config('role','service_role',true);
  response:=public.settle_bank_transaction(bank,true);
  ASSERT response->>'outcome'='flagged_not_pending',response::text;
  response:=public.settle_bank_transaction(bank,true);
  ASSERT response->>'already_settled'='true',response::text;
  PERFORM set_config('role','none',true);
  ASSERT (SELECT count(*)=1 FROM public.payment_settlements WHERE bank_transaction_id=bank);
  RAISE EXCEPTION 'rollback business rejection probe' USING ERRCODE='P0741';
 EXCEPTION WHEN SQLSTATE 'P0741' THEN NULL;
 END;
 ASSERT NOT EXISTS(SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id=bank);
 -- Restore real core, then retry the SAME synthetic bank event after removing the fault.
 EXECUTE (SELECT definition FROM fnb741_original_core);
 PERFORM set_config('role','service_role',true);
 response:=public.settle_bank_transaction(bank,true);
 ASSERT response->>'outcome'='auto_confirmed',response::text;
 response:=public.settle_bank_transaction(bank,true);
 ASSERT response->>'already_settled'='true' AND response->>'outcome'='auto_confirmed',response::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT status='paid' AND subtotal_vnd=5000 AND cogs_vnd=2000 FROM public.fnb_orders WHERE id=(f->>'order')::uuid);
 ASSERT (SELECT status='matched' FROM public.bank_transactions WHERE id=bank);
 ASSERT (SELECT count(*)=1 FROM public.payment_settlements WHERE bank_transaction_id=bank AND outcome='auto_confirmed');
 ASSERT (SELECT count(*)=1 AND sum(delta)=-2 FROM public.fnb_stock_movements WHERE ref_id=(f->>'order')::uuid AND reason='sale');
 ASSERT (SELECT on_hand=8 FROM public.fnb_ingredients WHERE id=(f->>'ingredient')::uuid);
 -- Original720 terminal audit is not rewritten, retried or silently recovered.
 ASSERT EXISTS(SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id=(f->>'bank')::uuid AND outcome='flagged_not_pending' AND reason LIKE 'column "old_status" is of type%');
END $$;
SELECT 'FNB741_PARENT_DIGEST='||md5(pg_get_functiondef('public.settle_bank_transaction(uuid,boolean)'::regprocedure));
ROLLBACK;
SELECT 'FNB741_TECHNICAL_FAULT_NO_TERMINAL_AUDIT_SAME_EVENT_RETRY_REAL_CORE_EXACTLY_ONCE_ROLLBACK_PASS';
