\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT md5(pg_get_functiondef('public.op_create_open_table(text,bigint,bigint,bigint,integer)'::regprocedure))='1e522dbfcbaa77628b231351fb1fb4e4';
 ASSERT (SELECT count(*)<=1 FROM public.online_poker_config WHERE id);
END $$;
CREATE TEMP TABLE online767_before AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.online_poker_tables x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.online_poker_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.online_poker_config x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_prize_payments x)
 )::text) fingerprint;
SAVEPOINT diagnostic;
INSERT INTO public.online_poker_config(id,enabled) VALUES(true,true)
 ON CONFLICT(id) DO UPDATE SET enabled=true;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE a jsonb;b jsonb;BEGIN
 a:=public.op_create_open_table('LOCAL767-RETRY-DIAGNOSTIC',25,50,5000,9);
 b:=public.op_create_open_table('LOCAL767-RETRY-DIAGNOSTIC',25,50,5000,9);
 ASSERT a->>'outcome'='ok' AND b->>'outcome'='ok';
 ASSERT a->>'table_id'<>b->>'table_id','diagnostic expected current lack of replay identity';
 ASSERT (SELECT count(*)=2 FROM public.online_poker_tables WHERE id IN((a->>'table_id')::uuid,(b->>'table_id')::uuid));
 ASSERT (SELECT count(*)=2 AND sum(stack)=10000 FROM public.online_poker_seats WHERE table_id IN((a->>'table_id')::uuid,(b->>'table_id')::uuid));
 RAISE NOTICE 'ONLINE767_UNKEYED_RETRY_CREATES_TWO_TABLES_CONFIRMED_NOT_A_FIX_PASS';
END $$;
ROLLBACK TO SAVEPOINT diagnostic;
DO $$ BEGIN ASSERT (SELECT fingerprint FROM online767_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.online_poker_tables x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.online_poker_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.online_poker_config x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_prize_payments x)
 )::text),'diagnostic business/config proof changed';END $$;
ROLLBACK;
SELECT 'ONLINE767_NATIVE_DIAGNOSTIC_ROLLED_BACK_TABLES_SEATS_CONFIG_MONEY_UNCHANGED';
