$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../../supabase/migrations/20270128000271_legacy_bag_active_hand_guard_v1.sql'
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne 'FB8A0C1C4FEEDF795F538D1F35FF0D151997CBD2B4C1A748E99C65CE28F10676') { throw 'source271 drift' }
$candidate = (Get-Content -LiteralPath $sourcePath -Raw) -replace '(?m)^BEGIN;\r?$', '' -replace '(?m)^COMMIT;\r?$', ''
$test = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag632.active-hand.rollback.sql') -Raw
if ($test.IndexOf('BEGIN;') -lt 0 -or $test.LastIndexOf('ROLLBACK;') -lt 0) { throw 'snapshot anchors drift' }
$before = $test.Substring(0,$test.IndexOf('BEGIN;'))
$after = $test.Substring($test.LastIndexOf('ROLLBACK;')+'ROLLBACK;'.Length) -replace "(?m)^SELECT 'BAG632_DIAGNOSTIC_FULL_ROLLBACK_PASS_NOT_FEATURE_PASS';\r?$",''
$prefix = @'
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.bag_active_hand_backup271') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000271');
END $$;
CREATE TABLE floor_private.bag_active_hand_backup271 AS
 SELECT signature,replace(pg_get_functiondef(p.oid),chr(13),'') definition,p.proacl::text acl,
 md5(replace(pg_get_functiondef(p.oid),chr(13),'')) before_digest,expected_after after_digest
 FROM (VALUES
 ('public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean)','375fd103dd5cd79969a2f13f87bc0fbe'),
 ('public.chip_ops_close_day(uuid,integer,integer,boolean,text)','c0905d118faa20955de085ff8329c4de')
 ) x(signature,expected_after) JOIN pg_proc p ON p.oid=to_regprocedure(x.signature);
ALTER TABLE floor_private.bag_active_hand_backup271 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.bag_active_hand_backup271 FROM PUBLIC,anon,authenticated,service_role;
'@
$post = @'
DO $$ DECLARE v record;BEGIN
 ASSERT (SELECT count(*) FROM floor_private.bag_active_hand_backup271)=2;
 FOR v IN SELECT * FROM floor_private.bag_active_hand_backup271 LOOP
  ASSERT md5(replace(pg_get_functiondef(to_regprocedure(v.signature)),chr(13),''))=v.after_digest;
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(v.signature)) IS NOT DISTINCT FROM v.acl;
 END LOOP;
 ASSERT NOT has_table_privilege('authenticated','floor_private.bag_active_hand_backup271','SELECT');
 ASSERT NOT has_table_privilege('anon','floor_private.bag_active_hand_backup271','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.bag_active_hand_backup271','SELECT');
END $$;
SAVEPOINT recovery_rehearsal;
'@
$recovery = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag634.recover.local.sql') -Raw
$recovery = $recovery -replace '(?m)^\s*\set ON_ERROR_STOP on\r?$','' -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^COMMIT;\r?$',''
$verify = @'
ROLLBACK TO SAVEPOINT recovery_rehearsal;
DO $$ DECLARE v record;BEGIN
 FOR v IN SELECT * FROM floor_private.bag_active_hand_backup271 LOOP
  ASSERT md5(replace(pg_get_functiondef(to_regprocedure(v.signature)),chr(13),''))=v.after_digest;
 END LOOP;
END $$;
'@
($before+"`n"+$prefix+"`n"+$candidate+"`n"+$post+"`n"+$recovery+"`n"+$verify+"`n"+$after+"`nCOMMIT;`nSELECT 'BAG634_LOCAL271_INSTALL_EXACT_RECOVERY_REHEARSAL_TEN_FACTS_UNCHANGED_PASS';") | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'local271 installation failed; inspect before retry' }
