BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN ('pg_net','pg_cron'));
END $$;
SET LOCAL request.jwt.claim.sub='1cc90e71-883d-40c0-8671-1f38929ecadc';
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 UPDATE public.staking_purchases SET transfer_proof_submitted=true
 WHERE id='aee6e467-b57d-4cee-a7bc-f8f237b8c9db' AND deal_id='dcb80d0d-e573-42a5-aef4-dbf1d98af39e'
 AND backer_id=auth.uid() AND status='committed';
 GET DIAGNOSTICS n=ROW_COUNT;
 ASSERT n=1;
 ASSERT (SELECT transfer_proof_submitted FROM public.staking_purchases WHERE id='aee6e467-b57d-4cee-a7bc-f8f237b8c9db');
 UPDATE public.staking_purchases SET status='cancelled',cancellation_reason='backer_cancelled'
 WHERE id='aee6e467-b57d-4cee-a7bc-f8f237b8c9db' AND deal_id='dcb80d0d-e573-42a5-aef4-dbf1d98af39e'
 AND backer_id=auth.uid() AND status='committed';
 GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=1;
 UPDATE public.staking_purchases SET status='cancelled',cancellation_reason='backer_cancelled'
 WHERE id='aee6e467-b57d-4cee-a7bc-f8f237b8c9db' AND deal_id='dcb80d0d-e573-42a5-aef4-dbf1d98af39e'
 AND backer_id=auth.uid() AND status='committed';
 GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=0;
 RAISE NOTICE 'TRANSFER522 native owned proof/cancel/zero-match PASS; full rollback';
END $$;
ROLLBACK;
