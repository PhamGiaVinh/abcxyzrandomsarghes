\set ON_ERROR_STOP on
\if :{?FNB720_ENUM_CANDIDATE}
\else
\set FNB720_ENUM_CANDIDATE false
\endif
BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';SET LOCAL test.fnb720_enum='on';
\if :FNB720_ENUM_CANDIDATE
-- APPLY_ENUM_CANDIDATE720
\endif
DO $$ DECLARE f jsonb;response jsonb;bank uuid:=gen_random_uuid();account text;reference text;
BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT fixture INTO STRICT f FROM floor_private.fnb720_fixture;ASSERT f->>'test_only'='true';
 SELECT account_number INTO STRICT account FROM public.bank_transactions WHERE id=(f->>'bank')::uuid AND account_number LIKE 'TEST-NON-BANK720-%';
 SELECT reference_code INTO STRICT reference FROM public.fnb_orders WHERE id=(f->>'order')::uuid AND status='pending' AND subtotal_vnd=5000;
 ASSERT (SELECT on_hand=10 FROM public.fnb_ingredients WHERE id=(f->>'ingredient')::uuid);
 -- Original failed bank outcome must remain preserved, not reset for a green test.
 ASSERT EXISTS(SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id=(f->>'bank')::uuid
  AND outcome='flagged_not_pending' AND reason LIKE 'column "old_status" is of type%');
 ASSERT (SELECT guest_bank_auto_confirm FROM public.fnb_settings WHERE club_id=(f->>'club')::uuid);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 -- Direct existing core, isolated subtransaction. Old code raises42804 here.
 BEGIN
  PERFORM set_config('role','service_role',true);
  response:=public.fnb_settle_bank_paid((f->>'order')::uuid,(f->>'bank')::uuid);
  ASSERT response->>'ok'='true',response::text;
  PERFORM set_config('role','none',true);
  ASSERT EXISTS(SELECT 1 FROM public.fnb_order_events WHERE order_id=(f->>'order')::uuid AND action='paid' AND old_status='pending' AND new_status='paid');
  ASSERT (SELECT on_hand=8 FROM public.fnb_ingredients WHERE id=(f->>'ingredient')::uuid);
  RAISE EXCEPTION USING ERRCODE='P0720',MESSAGE='rollback direct core probe';
 EXCEPTION WHEN SQLSTATE 'P0720' THEN NULL;
 END;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT status='pending' FROM public.fnb_orders WHERE id=(f->>'order')::uuid);
 -- Separate synthetic verified event ONLY inside this outer rollback transaction;
 -- this is not recovery/rematching of the original terminal bank event.
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at)
 VALUES(bank,'sepay','LOCAL720-ROLLBACK-'||bank,account,(f->>'club')::uuid,5000,'in',reference,clock_timestamp());
 PERFORM set_config('role','service_role',true);
 response:=public.settle_bank_transaction(bank,true);ASSERT response->>'outcome'='auto_confirmed',response::text;
 response:=public.settle_bank_transaction(bank,true);ASSERT response->>'already_settled'='true' AND response->>'outcome'='auto_confirmed',response::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT status='paid' AND subtotal_vnd=5000 AND cogs_vnd=2000 FROM public.fnb_orders WHERE id=(f->>'order')::uuid);
 ASSERT (SELECT on_hand=8 FROM public.fnb_ingredients WHERE id=(f->>'ingredient')::uuid);
 ASSERT (SELECT count(*)=1 AND sum(delta)=-2 FROM public.fnb_stock_movements WHERE ref_id=(f->>'order')::uuid AND reason='sale');
 ASSERT (SELECT count(*)=1 FROM public.payment_settlements WHERE bank_transaction_id=bank AND outcome='auto_confirmed');
 ASSERT (SELECT status='matched' FROM public.bank_transactions WHERE id=bank);
END $$;
ROLLBACK;
SELECT 'FNB720_ENUM_PROTOTYPE_CORE_AND_PARENT_FROZEN_PRICE_STOCK_AUDIT_REPLAY_ROLLBACK_NOT_ORIGINAL_BANK_RECOVERY';
