\set ON_ERROR_STOP on
BEGIN;SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='e7040000-0000-4000-8000-000000000002');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE id='379600a2-fd2d-4e6d-8004-b52b3d681740' AND status='applied' AND entries_snapshot=3 AND prize_pool_snapshot=300000);
END $$;
-- Synthetic browser metadata only, not registrations, payment, paid-tour or E2E proof.
-- Preserve703 zero-entry-snapshot fixture as recorded; do not repair historical runs.
INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object(
 'id','e7040000-0000-4000-8000-000000000002','name','LOCAL704 synthetic browser manual payout TEST',
 'current_players',0,'players_remaining',0,'created_at',now(),'updated_at',now()))).*
 FROM public.tournaments t WHERE id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08';
INSERT INTO public.tournament_payout_runs SELECT (jsonb_populate_record(NULL::public.tournament_payout_runs,to_jsonb(r)||jsonb_build_object(
 'id','e7040000-0000-4000-8000-000000000003','tournament_id','e7040000-0000-4000-8000-000000000002','generated_at',now()))).*
 FROM public.tournament_payout_runs r WHERE id='379600a2-fd2d-4e6d-8004-b52b3d681740';
INSERT INTO public.tournament_prizes(id,tournament_id,position,percentage,amount)
 VALUES('e7040000-0000-4000-8000-000000000004','e7040000-0000-4000-8000-000000000002',1,100,300000);
DO $$ BEGIN
 ASSERT (SELECT count(*)=0 FROM public.tournament_entries WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
 ASSERT (SELECT count(*)=0 FROM public.cashier_buyin_movements WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
 ASSERT (SELECT count(*)=0 FROM public.tournament_prize_payments WHERE tournament_id='e7040000-0000-4000-8000-000000000002');
END $$;
COMMIT;
SELECT 'PAYOUT704_SYNTHETIC_BROWSER_METADATA_SEEDED_NO_CASH_ENTRIES_PAYMENTS_NOT_PAID_JOURNEY';
