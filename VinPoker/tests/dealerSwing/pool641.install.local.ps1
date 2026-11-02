$ErrorActionPreference='Stop'
$sourcePath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000273_dealer_pool_operating_day_read_v1.sql'
if((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne '282F361C5021E63CB8482ABFFD5320E1DF1D0AEF0F365DE257B36E304FBA566B'){throw 'source273 drift'}
$candidate=(Get-Content -LiteralPath $sourcePath -Raw) -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^COMMIT;\r?$',''
$snapshot=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'single638.stale-attendance.rollback.sql') -Raw
$anchor='SELECT pg_temp.single638_facts() AS before \gset'
$at=$snapshot.IndexOf($anchor)
if($at -lt 0){throw 'pool641 snapshot anchor drift'}
$snapshot=$snapshot.Substring(0,$at+$anchor.Length)
$pre=@'
BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000273');
END $$;
'@
$post=@'
DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','EXECUTE');
 ASSERT has_function_privilege('service_role','public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','EXECUTE');
END $$;
SAVEPOINT revoke_recovery;
REVOKE EXECUTE ON FUNCTION public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[]) FROM service_role;
DO $$ BEGIN ASSERT NOT has_function_privilege('service_role','public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','EXECUTE'); END $$;
ROLLBACK TO revoke_recovery;
DO $$ BEGIN ASSERT has_function_privilege('service_role','public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])','EXECUTE'); END $$;
SELECT pg_temp.single638_facts()=:'before' AS unchanged \gset
\if :unchanged
\else
DO $$ BEGIN RAISE EXCEPTION 'pool641_install_operational_delta'; END $$;
\endif
COMMIT;
SELECT md5(replace(pg_get_functiondef('public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])'::regprocedure),chr(13),''));
SELECT 'POOL641_LOCAL273_SERVICE_ONLY_REVOKE_RECOVERY_FOURTEEN_FACTS_UNCHANGED_PASS';
'@
($snapshot+"`n"+$pre+"`n"+$candidate+"`n"+$post) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'local273 install failed; inspect before retry'}
