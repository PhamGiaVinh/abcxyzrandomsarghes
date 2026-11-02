param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit -Apply required for named LOCAL database only'}
Set-Location (Join-Path $PSScriptRoot '../..')
$migration=Get-Content -Raw supabase/migrations/20270128000282_fnb_create_receipt_read_v1.sql
if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected migration boundary'}
$migration=[regex]::Replace($migration,'(?m)^(BEGIN|COMMIT);\r?\n?','')
$sql=@'
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regprocedure('public.fnb_get_create_receipt_v1(uuid,text,uuid)') IS NULL,'constructor consumed; do not reset';
 ASSERT md5(pg_get_functiondef('public.fnb_create_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,uuid,uuid)'::regprocedure))='4b03c3050f53ebc040b4c3330f998564';
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000282');
END $$;
'@
$sql+="`n"+$migration+@'

DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.fnb_get_create_receipt_v1(uuid,text,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.fnb_get_create_receipt_v1(uuid,text,uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.fnb_get_create_receipt_v1(uuid,text,uuid)','EXECUTE');
 ASSERT (SELECT proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure);
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000282');
END $$;
COMMIT;
SELECT md5(pg_get_functiondef('public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure));
SELECT 'FNB736_EXACT282_READ_ONLY_RECEIPT_LOCAL_INSTALLED_NO_BUSINESS_LEDGER_WRITES';
'@
$sql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'FNB736 local install failed; disconnected transaction rolls back'}
