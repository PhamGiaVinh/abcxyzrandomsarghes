\set ON_ERROR_STOP on
-- Retained native PG17 only: no migration/auth helper replacement, no commit.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT md5(pg_get_functiondef('public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)'::regprocedure))='da643ca448cb56633268c8b377895b19';
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN('e2700000-0000-4000-8000-000000000001','e2700000-0000-4000-8000-000000000002','e2700000-0000-4000-8000-000000000003'));
END $guard$;
INSERT INTO auth.users(id) VALUES('e2700000-0000-4000-8000-000000000001'),('e2700000-0000-4000-8000-000000000002'),('e2700000-0000-4000-8000-000000000003');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e2700000-0000-4000-8000-000000000010','e2700000-0000-4000-8000-000000000001','Bank actor270 rollback TEST','TEST');
INSERT INTO public.club_chip_masters(club_id,user_id,granted_by) VALUES('e2700000-0000-4000-8000-000000000010','e2700000-0000-4000-8000-000000000002','e2700000-0000-4000-8000-000000000001');
INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES('e2700000-0000-4000-8000-000000000020','e2700000-0000-4000-8000-000000000010','Bank actor270 rollback TEST','live','playing');
INSERT INTO public.chip_set(id,club_id,name) VALUES('e2700000-0000-4000-8000-000000000030','e2700000-0000-4000-8000-000000000010','Bank actor270 rollback TEST');
INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('e2700000-0000-4000-8000-000000000040','e2700000-0000-4000-8000-000000000030','e2700000-0000-4000-8000-000000000010',100);
SELECT set_config('request.jwt.claim.sub','e2700000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"sub":"e2700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $owner$
DECLARE first jsonb; replay jsonb;
BEGIN
 first:=public.chip_ops_bank_adjust('e2700000-0000-4000-8000-000000000010','e2700000-0000-4000-8000-000000000040','thu',12,'e2700000-0000-4000-8000-000000000020',0,'bank-actor270-original');
 ASSERT first->>'status'='ok' AND (first->>'balance_after')::bigint=12;
 replay:=public.chip_ops_bank_adjust('e2700000-0000-4000-8000-000000000010','e2700000-0000-4000-8000-000000000040','thu',12,'e2700000-0000-4000-8000-000000000020',0,'bank-actor270-original');
 ASSERT replay->>'status'='ok' AND (replay->>'idempotent')::boolean AND replay->'balance_after'=first->'balance_after';
END $owner$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e2700000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"e2700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $master$
DECLARE answer jsonb;
BEGIN
 ASSERT public.is_club_chip_master(auth.uid(),'e2700000-0000-4000-8000-000000000010');
 answer:=public.chip_ops_bank_adjust('e2700000-0000-4000-8000-000000000010','e2700000-0000-4000-8000-000000000040','thu',12,'e2700000-0000-4000-8000-000000000020',0,'bank-actor270-original');
 ASSERT answer->>'error'='IDEMPOTENCY_CONFLICT','authorized different actor must not adopt original receipt';
END $master$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e2700000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e2700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $outsider$
DECLARE answer jsonb;
BEGIN
 answer:=public.chip_ops_bank_adjust('e2700000-0000-4000-8000-000000000010','e2700000-0000-4000-8000-000000000040','thu',12,'e2700000-0000-4000-8000-000000000020',0,'bank-actor270-original');
 ASSERT answer->>'error'='Forbidden';
END $outsider$;
RESET ROLE;
DO $facts$
BEGIN
 ASSERT (SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='e2700000-0000-4000-8000-000000000010')=1;
 ASSERT EXISTS(SELECT 1 FROM public.chip_bank_ledger WHERE idempotency_key='bank-actor270-original' AND actor='e2700000-0000-4000-8000-000000000001' AND count=12 AND balance_after=12 AND details->>'expected_version'='0');
 ASSERT EXISTS(SELECT 1 FROM public.chip_bank WHERE club_id='e2700000-0000-4000-8000-000000000010' AND on_hand_count=12 AND version=1);
 ASSERT NOT has_function_privilege('anon','public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)','EXECUTE');
END $facts$;
ROLLBACK;
SELECT 'BANK_ACTOR270_NATIVE_ROLE_REPLAY_CONFLICT_ROLLBACK_PASS';
