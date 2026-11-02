param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Isolated LOCAL only; -Apply required'}
$taskPath620=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000268_bag_table_label_canonical_v1.sql'
if((Get-FileHash -LiteralPath $taskPath620 -Algorithm SHA256).Hash -ne '97FA9D3AACB5D9428B21163A7870F51A4335EA1A0AA0B694F4A05B021182CC2F'){throw '620 source drift'}
$taskBody620=Get-Content -LiteralPath $taskPath620 -Raw
$taskLabels620=[regex]::Replace((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag619.labels.rollback.sql') -Raw),'(?m)^(BEGIN READ ONLY|ROLLBACK);\r?$','')
$taskAuth620=[regex]::Replace((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag617.authorization.rollback.sql') -Raw),'(?m)^(BEGIN|ROLLBACK);\r?$','')
$taskRecovery620=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag620.recover.local.sql') -Raw
$taskPre620=@'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000268');
 ASSERT to_regclass('floor_private.bag_table_label_backup268') IS NULL;
 ASSERT to_regprocedure('floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)') IS NULL;
 ASSERT md5(replace(pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure),chr(13),''))='a5aa884f5e3c4e7e5befeeb9efeb91c3';
 ASSERT md5(replace(pg_get_functiondef('public.get_bag_tag_state(uuid,integer)'::regprocedure),chr(13),''))='1675b416f1aadd066e0b93f153ae0112';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid IN('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure,'public.get_bag_tag_state(uuid,integer)'::regprocedure)
  AND (proacl::text<>'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' OR proowner<>'postgres'::regrole));
END $$;
CREATE TABLE floor_private.bag_table_label_backup268(signature text PRIMARY KEY,before_definition text,before_acl text,after_definition text,after_acl text);
ALTER TABLE floor_private.bag_table_label_backup268 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.bag_table_label_backup268 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.bag_table_label_backup268(signature,before_definition,before_acl)
 SELECT oid::regprocedure::text,pg_get_functiondef(oid),proacl::text FROM pg_proc
 WHERE oid IN('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure,'public.get_bag_tag_state(uuid,integer)'::regprocedure);
CREATE FUNCTION pg_temp.bag620_facts() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);
$$;
CREATE TEMP TABLE bag620_before AS SELECT pg_temp.bag620_facts() facts;
'@
$taskMiddle620=@'
UPDATE floor_private.bag_table_label_backup268 SET after_definition=pg_get_functiondef(to_regprocedure(signature)),
 after_acl=(SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(signature));
INSERT INTO floor_private.bag_table_label_backup268(signature,after_definition,after_acl)
 SELECT oid::regprocedure::text,pg_get_functiondef(oid),proacl::text FROM pg_proc
 WHERE oid='floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)'::regprocedure;
SAVEPOINT bag620_recovery;
'@
$taskPost620=@'
DO $$ BEGIN
 ASSERT pg_temp.bag620_facts()=(SELECT facts FROM bag620_before);
 ASSERT (SELECT count(*) FROM floor_private.bag_table_label_backup268)=3;
 ASSERT NOT has_table_privilege('authenticated','floor_private.bag_table_label_backup268','SELECT');
 ASSERT NOT has_table_privilege('anon','floor_private.bag_table_label_backup268','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.bag_table_label_backup268','SELECT');
 ASSERT NOT has_function_privilege('authenticated','floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.bag_table_label_backup268 WHERE before_definition IS NOT NULL AND before_acl IS DISTINCT FROM after_acl);
END $$;
COMMIT;
SELECT 'BAG620_LOCAL_LABELS_OWNER_OUTSIDER_PRIVATE_ACL_RECOVERY_SEVEN_FACTS_UNCHANGED_NO_LEDGER_PASS';
'@
($taskPre620+"`n"+$taskBody620+"`n"+$taskMiddle620+"`n"+$taskRecovery620+"`nROLLBACK TO bag620_recovery;`n"+$taskLabels620+"`n"+$taskAuth620+"`n"+$taskPost620) |
 wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw '620 isolated install failed; transaction rolled back'}
