\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ DECLARE f jsonb;BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT fixture INTO STRICT f FROM floor_private.fnb720_fixture;ASSERT f->>'test_only'='true';
 ASSERT md5(pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure))='458176bb3c8b293d0c44056b15309670','enum patch must still be rollback-only';
 ASSERT (SELECT status='pending' AND subtotal_vnd=5000 FROM public.fnb_orders WHERE id=(f->>'order')::uuid);
 ASSERT (SELECT on_hand=10 FROM public.fnb_ingredients WHERE id=(f->>'ingredient')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_stock_movements WHERE ref_id=(f->>'order')::uuid);
 ASSERT (SELECT count(*)=2 FROM public.payment_settlements WHERE bank_transaction_id IN((f->>'bank')::uuid,(f->>'bad_bank')::uuid));
 ASSERT EXISTS(SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id=(f->>'bad_bank')::uuid AND outcome='flagged_amount_mismatch');
 ASSERT EXISTS(SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id=(f->>'bank')::uuid AND outcome='flagged_not_pending' AND reason LIKE 'column "old_status" is of type%');
 ASSERT (SELECT status='unmatched' FROM public.bank_transactions WHERE id=(f->>'bank')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.bank_transactions WHERE provider_txn_id LIKE 'LOCAL720-ROLLBACK-%');
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid());
END $$;
ROLLBACK;
SELECT 'FNB720_FAILED_EVIDENCE_PRESERVED_ENUM_PATCH_AND_POSITIVE_BANK_EVENT_ROLLED_BACK_NO_IDLE_TX';
