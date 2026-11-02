$ErrorActionPreference='Stop'
$taskBody623=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../supabase/migrations/20270128000269_bag_day_write_serialization_v1.sql') -Raw
$taskPre623=@'
\set ON_ERROR_STOP on
CREATE TEMP TABLE bag623_before AS SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl
 FROM pg_proc WHERE oid IN('public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean)'::regprocedure,
 'public.chip_ops_unseal_bag(uuid)'::regprocedure,'public.chip_ops_close_day(uuid,integer,integer,boolean,text)'::regprocedure,'public.chip_ops_reopen_day(uuid,integer,integer)'::regprocedure);
CREATE FUNCTION pg_temp.bag623_facts() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);
$$;
CREATE TEMP TABLE bag623_facts_before AS SELECT pg_temp.bag623_facts() facts;
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regprocedure('floor_private.lock_chip_bag_day_v1(uuid,integer)') IS NULL;
 ASSERT (SELECT count(*) FROM public.day_close WHERE tournament_id='e6220000-0000-4000-8000-000000000001' AND day_number=1 AND status='open' AND version=2)=1;
END $$;
'@
$taskPost623=@'
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;t uuid:='e6220000-0000-4000-8000-000000000001';b uuid:='e6220000-0000-4000-8000-000000000002';BEGIN
 r:=public.chip_ops_close_day(t,1,2,false,NULL);ASSERT r->>'status'='ok';
 ASSERT public.chip_ops_unseal_bag(b)->>'error'='REOPEN_FIRST';
 ASSERT public.chip_ops_record_bag(t,1,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','TEST623',1000,true)->>'error'='DAY_LOCKED';
 ASSERT public.chip_ops_reopen_day(t,1,3)->>'status'='ok';
 ASSERT public.chip_ops_record_bag(t,2,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','TEST623',1000,true)->>'error'='NO_ACTIVE_SEAT';
 ASSERT NOT EXISTS(SELECT 1 FROM public.day_close WHERE tournament_id=t AND day_number=2),'failed record created day';
 ASSERT public.chip_ops_close_day(t,2,0,false,NULL)->>'status'='ok';
 ASSERT public.chip_ops_reopen_day(t,2,1)->>'status'='ok';
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
DO $$ BEGIN
 ASSERT public.chip_ops_close_day('e6220000-0000-4000-8000-000000000001',1,4,false,NULL)->>'error'='Forbidden';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT has_function_privilege('authenticated','floor_private.lock_chip_bag_day_v1(uuid,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','floor_private.lock_chip_bag_day_v1(uuid,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.lock_chip_bag_day_v1(uuid,integer)','EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM bag623_before b JOIN pg_proc p ON p.oid=to_regprocedure(b.signature) WHERE p.proacl::text IS DISTINCT FROM b.acl);
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT to_regprocedure('floor_private.lock_chip_bag_day_v1(uuid,integer)') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM bag623_before b WHERE pg_get_functiondef(to_regprocedure(b.signature))<>b.definition);
 ASSERT pg_temp.bag623_facts()=(SELECT facts FROM bag623_facts_before);
END $$;
SELECT 'BAG623_CANDIDATE_SEQUENTIAL_DAY_LOCK_OWNER_OUTSIDER_ACL_FIRST_DAY_REJECTION_ROLLBACK_PASS';
'@
($taskPre623+"`n"+$taskBody623+"`n"+$taskPost623) |
 wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw '623 candidate failed; transaction rolled back'}
