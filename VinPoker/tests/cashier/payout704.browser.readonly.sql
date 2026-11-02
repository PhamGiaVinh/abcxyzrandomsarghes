\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*)=2 AND count(*) FILTER(WHERE status='applied')=1 FROM public.tournament_payout_runs WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE id='8af99e0f-6eec-4f09-b2ff-aa7f42200ef7' AND status='applied' AND source='manual_edit'
  AND tournament_id='e7040000-0000-4000-8000-000000000002' AND supersedes_run_id='e7040000-0000-4000-8000-000000000003' AND entries_snapshot=3 AND prize_pool_snapshot=300000);
 ASSERT (SELECT count(*)=1 AND sum(amount)=300000 FROM public.tournament_prizes WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
 ASSERT (SELECT count(*)=2 AND count(*) FILTER(WHERE result->>'status'='saved')=1 AND count(*) FILTER(WHERE result->>'status'='cancelled')=1
  FROM floor_private.payout_manual_edit_receipts_v1 WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
 ASSERT EXISTS(SELECT 1 FROM floor_private.payout_manual_edit_receipts_v1 WHERE actor_id='40b8f243-bf3b-4aaa-962b-db788380207c'
  AND request_id='c1bc4bca-9c16-47c0-83de-1d3c8dfd1d9c' AND result->>'run_id'='8af99e0f-6eec-4f09-b2ff-aa7f42200ef7');
 ASSERT EXISTS(SELECT 1 FROM floor_private.payout_manual_edit_receipts_v1 WHERE actor_id='40b8f243-bf3b-4aaa-962b-db788380207c'
  AND request_id='fd823df0-4344-46e5-8767-0e48d97fa280' AND result->>'status'='cancelled' AND result->>'previous_run_id'='8af99e0f-6eec-4f09-b2ff-aa7f42200ef7');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000277');
END $$;
ROLLBACK;
SELECT 'PAYOUT704_BROWSER_COMMITTED_SAVE_RECEIPT_RELOAD_CANCEL_RECOVERY_NO_CASH_PAYMENT_PASS';
