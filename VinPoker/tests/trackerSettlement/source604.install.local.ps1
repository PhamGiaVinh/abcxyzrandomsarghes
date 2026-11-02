param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Isolated LOCAL only; -Apply required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000266_tracker_source_trigger_privileges_v1.sql'
if((Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash -ne '914AE7CBE01781F72481EDBE97732D6646889D824EF07316F8689B0343834624'){throw 'source604 source drift'}
$taskMigration=[regex]::Replace((Get-Content -LiteralPath $taskPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskProbe=[regex]::Replace((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source604.trigger.rollback.sql') -Raw),'(?m)^(BEGIN|ROLLBACK);\r?$','')
$taskRecovery=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source604.recover.local.sql') -Raw
$taskWriters=[regex]::Replace((Get-Content -LiteralPath (Join-Path $PSScriptRoot '../cashier/historyWriterRevision.existing.pg17.sql') -Raw),'(?m)^(BEGIN|ROLLBACK);\r?$','')
$taskPre=@'
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
   AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441,'LOCAL604_INSTALL_ONLY';
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000266'),'source604_ledger_collision';
 ASSERT to_regclass('floor_private.tracker_source_trigger_acl_backup266') IS NULL,'source604_already_installed';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_class WHERE oid IN('public.tournament_hands'::regclass,'public.hand_actions'::regclass,'public.hand_players'::regclass)
   AND (pg_get_userbyid(relowner)<>'postgres' OR relacl::text<>'{postgres=arwdDxtm/postgres,anon=arwdxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}')),'source604_pre_acl_drift';
END $$;
CREATE TABLE floor_private.tracker_source_trigger_acl_backup266(table_name text PRIMARY KEY,before_acl text NOT NULL,after_acl text);
ALTER TABLE floor_private.tracker_source_trigger_acl_backup266 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tracker_source_trigger_acl_backup266 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.tracker_source_trigger_acl_backup266(table_name,before_acl)
 SELECT oid::regclass::text,relacl::text FROM pg_class WHERE oid IN('public.tournament_hands'::regclass,'public.hand_actions'::regclass,'public.hand_players'::regclass);
CREATE FUNCTION pg_temp.source604_facts() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);
$$;
CREATE TEMP TABLE source604_install_before AS SELECT pg_temp.source604_facts() fingerprint,
 (SELECT md5(string_agg(pg_get_triggerdef(oid),'|' ORDER BY oid)) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN('public.tournament_hands'::regclass,'public.hand_actions'::regclass,'public.hand_players'::regclass)) triggers;
'@
$taskAfterMigration=@'
UPDATE floor_private.tracker_source_trigger_acl_backup266 b SET after_acl=c.relacl::text FROM pg_class c WHERE c.oid=to_regclass(b.table_name);
SAVEPOINT source604_recovery;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM source604_install_before)=pg_temp.source604_facts(),'source604_business_facts_drift';
 ASSERT (SELECT triggers FROM source604_install_before)=(SELECT md5(string_agg(pg_get_triggerdef(oid),'|' ORDER BY oid)) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN('public.tournament_hands'::regclass,'public.hand_actions'::regclass,'public.hand_players'::regclass)),'source604_existing_trigger_drift';
 ASSERT (SELECT count(*) FROM floor_private.tracker_source_trigger_acl_backup266 WHERE after_acl IS NOT NULL)=3;
 ASSERT NOT has_table_privilege('anon','floor_private.tracker_source_trigger_acl_backup266','SELECT');
 ASSERT NOT has_table_privilege('authenticated','floor_private.tracker_source_trigger_acl_backup266','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.tracker_source_trigger_acl_backup266','SELECT');
 RAISE NOTICE 'SOURCE604_SEVEN_BUSINESS_FACTS_AND_EXISTING_TRIGGERS_UNCHANGED_PASS';
END $$;
SELECT fingerprint FROM source604_install_before;
COMMIT;
'@
($taskPre+"`n"+$taskMigration+"`n"+$taskAfterMigration+"`n"+$taskRecovery+"`nROLLBACK TO source604_recovery;`n"+$taskProbe+"`n"+$taskWriters+"`n"+$taskPost) |
 wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'source604 install failed; transaction rolled back'}
Write-Output 'SOURCE604_LOCAL_INSTALLED_NO_LEDGER'
