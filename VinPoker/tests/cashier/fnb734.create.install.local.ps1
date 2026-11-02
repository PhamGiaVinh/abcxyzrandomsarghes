param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit -Apply required for the named LOCAL database only'}
Set-Location (Join-Path $PSScriptRoot '../..')
$migration=Get-Content -Raw supabase/migrations/20270128000281_fnb_create_recovery_ordering_v1.sql
if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected transaction boundary'}
$migration=[regex]::Replace($migration,'(?m)^(BEGIN|COMMIT);\r?\n?','')
$sql=@'
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.fnb_create_backup734') IS NULL,'constructor consumed; never reset';
 ASSERT md5(pg_get_functiondef('public.fnb_create_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,uuid,uuid)'::regprocedure))='60212b28a72941f81499d72d1aaa92f3';
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000281');
END $$;
CREATE TABLE floor_private.fnb_create_backup734 AS
 SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig,prosecdef
 FROM pg_proc WHERE oid='public.fnb_create_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,uuid,uuid)'::regprocedure;
ALTER TABLE floor_private.fnb_create_backup734 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_create_backup734 FROM PUBLIC,anon,authenticated,service_role;
'@
$sql+="`n"+$migration+@'

DO $$ BEGIN
 ASSERT md5(pg_get_functiondef('public.fnb_create_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,uuid,uuid)'::regprocedure))='4b03c3050f53ebc040b4c3330f998564','must match actual two-session-qualified clone body';
 ASSERT (SELECT p.proowner=b.proowner AND p.proacl=b.proacl AND p.proconfig=b.proconfig AND p.prosecdef=b.prosecdef
  FROM pg_proc p CROSS JOIN floor_private.fnb_create_backup734 b WHERE p.oid=b.signature::regprocedure);
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000281');
END $$;
COMMIT;
SELECT 'FNB734_EXACT281_LOCAL_CREATE_INSTALLED_AUTHORITY_PRESERVED_PRIVATE_BACKUP_NO_BUSINESS_LEDGER_WRITE';
'@
$sql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'FNB734 local install failed; disconnected transaction rolls back'}
