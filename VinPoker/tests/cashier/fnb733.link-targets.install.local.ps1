param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit -Apply required for the named LOCAL database only'}
Set-Location (Join-Path $PSScriptRoot '../..')
$migration=Get-Content -Raw supabase/migrations/20270128000280_fnb_canonical_link_targets_v1.sql
if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected transaction boundaries'}
$migration=[regex]::Replace($migration,'(?m)^(BEGIN|COMMIT);\r?\n?','')
$sql=@'
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.fnb_link_reader_backup733') IS NULL,'constructor consumed; never reset';
 ASSERT md5(pg_get_functiondef('public.fnb_list_link_targets(uuid)'::regprocedure))='638cb830a272e4cbcc897fdb6aa0bd65';
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000280');
END $$;
CREATE TABLE floor_private.fnb_link_reader_backup733 AS
 SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig,prosecdef
 FROM pg_proc WHERE oid='public.fnb_list_link_targets(uuid)'::regprocedure;
ALTER TABLE floor_private.fnb_link_reader_backup733 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_link_reader_backup733 FROM PUBLIC,anon,authenticated,service_role;
'@
$sql+="`n"+$migration+@'

DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.fnb_list_link_targets(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.fnb_list_link_targets(uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.fnb_list_link_targets(uuid)','EXECUTE');
 ASSERT (SELECT proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.fnb_list_link_targets(uuid)'::regprocedure);
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000280');
END $$;
COMMIT;
SELECT 'FNB733_LOCAL_EXACT280_READER_INSTALLED_PRIVATE_BACKUP_NO_BUSINESS_OR_LEDGER_WRITES';
'@
$sql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'FNB733 local install failed; disconnected transaction rolls back'}
