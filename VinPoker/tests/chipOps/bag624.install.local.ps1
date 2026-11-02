param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Isolated LOCAL only; -Apply required'}
$taskPath624=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000269_bag_day_write_serialization_v1.sql'
if((Get-FileHash -LiteralPath $taskPath624 -Algorithm SHA256).Hash -ne '90056CE2E662C218D8B646684A40E938DDEABDBA991F3B568073D0C0E015B107'){throw '624 source drift'}
$taskBody624=Get-Content -LiteralPath $taskPath624 -Raw
$taskRecovery624=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag624.recover.local.sql') -Raw
$taskPre624=@'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000269');
 ASSERT to_regclass('floor_private.bag_day_lock_backup269') IS NULL;
 ASSERT to_regprocedure('floor_private.lock_chip_bag_day_v1(uuid,integer)') IS NULL;
END $$;
CREATE TABLE floor_private.bag_day_lock_backup269(signature text PRIMARY KEY,before_definition text,before_acl text,after_definition text,after_acl text);
ALTER TABLE floor_private.bag_day_lock_backup269 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.bag_day_lock_backup269 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.bag_day_lock_backup269(signature,before_definition,before_acl)
 SELECT oid::regprocedure::text,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE oid IN(
 'public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean)'::regprocedure,'public.chip_ops_unseal_bag(uuid)'::regprocedure,
 'public.chip_ops_close_day(uuid,integer,integer,boolean,text)'::regprocedure,'public.chip_ops_reopen_day(uuid,integer,integer)'::regprocedure);
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM floor_private.bag_day_lock_backup269)=4;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN floor_private.bag_day_lock_backup269 b ON p.oid=to_regprocedure(b.signature)
 WHERE p.proowner<>'postgres'::regrole OR p.proacl::text<>'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}');
END $$;
CREATE FUNCTION pg_temp.bag624_facts() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);
$$;
CREATE TEMP TABLE bag624_before AS SELECT pg_temp.bag624_facts() facts;
'@
$taskMiddle624=@'
UPDATE floor_private.bag_day_lock_backup269 SET after_definition=pg_get_functiondef(to_regprocedure(signature)),
 after_acl=(SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(signature));
INSERT INTO floor_private.bag_day_lock_backup269(signature,after_definition,after_acl)
 SELECT oid::regprocedure::text,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE oid='floor_private.lock_chip_bag_day_v1(uuid,integer)'::regprocedure;
SAVEPOINT bag624_recovery;
'@
$taskPost624=@'
DO $$ BEGIN
 ASSERT pg_temp.bag624_facts()=(SELECT facts FROM bag624_before);
 ASSERT NOT has_table_privilege('authenticated','floor_private.bag_day_lock_backup269','SELECT');
 ASSERT NOT has_table_privilege('anon','floor_private.bag_day_lock_backup269','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.bag_day_lock_backup269','SELECT');
 ASSERT NOT has_function_privilege('authenticated','floor_private.lock_chip_bag_day_v1(uuid,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','floor_private.lock_chip_bag_day_v1(uuid,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.lock_chip_bag_day_v1(uuid,integer)','EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.bag_day_lock_backup269 WHERE before_definition IS NOT NULL AND before_acl IS DISTINCT FROM after_acl);
END $$;
COMMIT;
SELECT 'BAG624_LOCAL_INSTALLED_EXACT_RECOVERY_ACL_AND_BUSINESS_FACTS_UNCHANGED_PASS';
'@
($taskPre624+"`n"+$taskBody624+"`n"+$taskMiddle624+"`n"+$taskRecovery624+"`nROLLBACK TO bag624_recovery;`n"+$taskPost624) |
 wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw '624 isolated install failed; transaction rolled back'}
