param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Exact isolated LOCAL target only; -Apply required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000236_tracker_source_table_privileges_v1.sql'
if((Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash -ne '9E715B26AAB3980EEAFD7F2B441133B987FE00CC108B73C68A4DC64EFC271D05'){throw 'source388 source drift'}
$taskBody=[regex]::Replace((Get-Content -LiteralPath $taskPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskPre=@'
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'source388_local_only';END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000236') THEN RAISE EXCEPTION 'source388_ledger_collision';END IF;
 IF to_regclass('floor_private.tracker_source_acl_backup236') IS NOT NULL THEN RAISE EXCEPTION 'source388_backup_exists_no_reinstall';END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN('public.tournament_hands'::regclass,'public.hand_actions'::regclass,'public.hand_players'::regclass)
  AND (pg_get_userbyid(relowner)<>'postgres' OR relacl::text<>'{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')) THEN RAISE EXCEPTION 'source388_pre_acl_drift';END IF;
END $$;
CREATE TABLE floor_private.tracker_source_acl_backup236(table_name text PRIMARY KEY,before_acl text NOT NULL,after_acl text);
ALTER TABLE floor_private.tracker_source_acl_backup236 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tracker_source_acl_backup236 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.tracker_source_acl_backup236(table_name,before_acl)
 SELECT oid::regclass::text,relacl::text FROM pg_class WHERE oid IN('public.tournament_hands'::regclass,'public.hand_actions'::regclass,'public.hand_players'::regclass);
CREATE TEMP TABLE source388_facts AS SELECT
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.tournament_hands t) hands,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.hand_actions t) actions,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.hand_players t) players,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text) FROM public.tournament_settlement_outcomes t) outcomes,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text) FROM public.tracker_historical_display_queue t) queue;
'@
$taskPost=@'
UPDATE floor_private.tracker_source_acl_backup236 b SET after_acl=c.relacl::text FROM pg_class c WHERE c.oid=to_regclass(b.table_name);
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM floor_private.tracker_source_acl_backup236 WHERE after_acl IS NOT NULL)=3;
 ASSERT NOT has_table_privilege('anon','floor_private.tracker_source_acl_backup236','SELECT');
 ASSERT NOT has_table_privilege('authenticated','floor_private.tracker_source_acl_backup236','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.tracker_source_acl_backup236','SELECT');
 ASSERT (SELECT hands FROM source388_facts) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.tournament_hands t);
 ASSERT (SELECT actions FROM source388_facts) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.hand_actions t);
 ASSERT (SELECT players FROM source388_facts) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.hand_players t);
 ASSERT (SELECT outcomes FROM source388_facts) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text) FROM public.tournament_settlement_outcomes t);
 ASSERT (SELECT queue FROM source388_facts) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text) FROM public.tracker_historical_display_queue t);
END $$;
COMMIT;
'@
($taskPre+"`n"+$taskBody+"`n"+$taskPost) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'source388 local install failed; transaction rolled back'}
Write-Output 'SOURCE388_LOCAL_INSTALLED_ACL_BACKUP3_FIVE_TABLE_FACTS_UNCHANGED_NO_LEDGER'
