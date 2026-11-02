param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit -Apply required for named LOCAL database only'}
Set-Location (Join-Path $PSScriptRoot '../..')
$migration=Get-Content -Raw supabase/migrations/20270128000283_fnb_create_cancel_fence_v1.sql
if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected boundary'}
$migration=[regex]::Replace($migration,'(?m)^(BEGIN|COMMIT);\r?\n?','')
$sql=@'
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.fnb738_fence_release_backup') IS NULL,'constructor consumed; never reset';
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000283');
END $$;
CREATE TABLE floor_private.fnb738_fence_release_backup AS
 SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig,prosecdef
 FROM pg_proc WHERE oid IN('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure,'public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure);
ALTER TABLE floor_private.fnb738_fence_release_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb738_fence_release_backup FROM PUBLIC,anon,authenticated,service_role;
'@
$sql+="`n"+$migration+@'

DO $$ BEGIN
 ASSERT md5(pg_get_functiondef('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure))='2f4a64f991f4f2b2caf0b10002cdf93c';
 ASSERT md5(pg_get_functiondef('public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure))='07e31abf9812e328d7b47d78d7cdb2a8';
 ASSERT md5(pg_get_functiondef('public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)'::regprocedure))='0f9dc8e006caf29ff71ef3149f7b30e1';
 ASSERT (SELECT bool_and(p.proowner=b.proowner AND p.proacl=b.proacl AND p.proconfig=b.proconfig AND p.prosecdef=b.prosecdef)
  FROM pg_proc p JOIN floor_private.fnb738_fence_release_backup b ON p.oid=b.signature::regprocedure);
 ASSERT NOT has_function_privilege('anon','public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)','EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.fnb_create_cancel_fences_v1);
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000283');
END $$;
COMMIT;
SELECT 'FNB738_EXACT_REVISED283_LOCAL_INSTALLED_THREE_CLONE_DIGESTS_AUTHORITY_PRESERVED_PRIVATE_BACKUP_NO_DATA_BACKFILL_LEDGER';
'@
$sql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'FNB738 local install failed; disconnected transaction rolls back'}
