param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Isolated native LOCAL only: -Apply required'}
$taskMigration618=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000267_bag_reconciliation_actor_authority_v1.sql'
if((Get-FileHash -LiteralPath $taskMigration618 -Algorithm SHA256).Hash -ne '5E117BDA549CC1FC9BA4774539638B97FDA32FA68462AA4910D9FF810CB9E682'){throw '618 reviewed source drift'}
$taskBody618=Get-Content -LiteralPath $taskMigration618 -Raw
$taskProbe618=[regex]::Replace((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag617.authorization.rollback.sql') -Raw),'(?m)^(BEGIN|ROLLBACK);\r?$','')
$taskRecover618=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag618.recover.local.sql') -Raw
$taskPre618=@'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000267');
 ASSERT to_regclass('floor_private.bag_reconciliation_authority_backup267') IS NULL,'bag618_already_installed';
 ASSERT md5(replace(pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure),chr(13),''))='bad2ba62801b342ccc438730272c51cd','bag618_pre_definition_drift';
 ASSERT (SELECT proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' AND proowner='postgres'::regrole
  FROM pg_proc WHERE oid='public.chip_ops_day_reconcile(uuid,integer)'::regprocedure),'bag618_pre_acl_owner_drift';
END $$;
CREATE TABLE floor_private.bag_reconciliation_authority_backup267(id boolean PRIMARY KEY CHECK(id),before_definition text NOT NULL,before_acl text NOT NULL,after_definition text);
ALTER TABLE floor_private.bag_reconciliation_authority_backup267 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.bag_reconciliation_authority_backup267 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.bag_reconciliation_authority_backup267 SELECT true,
 pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure),proacl::text,NULL FROM pg_proc
 WHERE oid='public.chip_ops_day_reconcile(uuid,integer)'::regprocedure;
CREATE FUNCTION pg_temp.bag618_facts() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);
$$;
CREATE TEMP TABLE bag618_before AS SELECT pg_temp.bag618_facts() facts;
'@
$taskMiddle618=@'
UPDATE floor_private.bag_reconciliation_authority_backup267 SET after_definition=pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure);
SAVEPOINT bag618_recovery;
'@
$taskPost618=@'
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 ASSERT (SELECT count(*)=2 AND sum(expected)=60000 FROM public.chip_ops_day_reconcile('46cab483-91e7-4220-aacf-e17bdf05269c',1));
 r:=public.get_bag_tag_state('46cab483-91e7-4220-aacf-e17bdf05269c',1);
 ASSERT jsonb_array_length(r->'players')=2 AND (r->'reconciliation'->>'total_expected_value')::bigint=60000;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT pg_temp.bag618_facts()=(SELECT facts FROM bag618_before);
 ASSERT NOT has_table_privilege('anon','floor_private.bag_reconciliation_authority_backup267','SELECT');
 ASSERT NOT has_table_privilege('authenticated','floor_private.bag_reconciliation_authority_backup267','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.bag_reconciliation_authority_backup267','SELECT');
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.chip_ops_day_reconcile(uuid,integer)'::regprocedure)=
  (SELECT before_acl FROM floor_private.bag_reconciliation_authority_backup267);
END $$;
COMMIT;
SELECT 'BAG618_LOCAL_INSTALLED_OWNER_OUTSIDER_BACKUP_RECOVERY_SEVEN_FACTS_UNCHANGED_NO_LEDGER_PASS';
'@
($taskPre618+"`n"+$taskBody618+"`n"+$taskMiddle618+"`n"+$taskRecover618+"`nROLLBACK TO bag618_recovery;`n"+$taskProbe618+"`n"+$taskPost618) |
 wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw '618 local install failed; transaction rolled back'}
