param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'LOCAL-only opt-in -Apply required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000238_tournament_fee_write_integrity_v1.sql'
if((Get-FileHash $taskPath -Algorithm SHA256).Hash -ne 'F6592F4CDE981EA447B969F283054DF99656DA2DE15763C17A98564D33A6D315'){throw 'reviewed238 source drift'}
$taskBody=[regex]::Replace((Get-Content $taskPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskTables=@('tournaments','cashier_buyin_movements','tournament_entries','tournament_seats','notifications')
$taskParts=$taskTables | ForEach-Object {'(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.'+$_+' t)'}
$taskFacts='SELECT md5(jsonb_build_array('+($taskParts -join ',')+')::text)'
$taskPre=@'
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000238');
 ASSERT to_regprocedure('floor_private.guard_tournament_fees238()') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_fee_integrity238');
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_guarantee237()'::regprocedure)='01e390e92a028871a8fc762525a78470';
END $$;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_fees238()'::regprocedure)='0f6268165f327d6b298d54c327ba97d0';
 ASSERT NOT has_function_privilege('anon','floor_private.guard_tournament_fees238()','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.guard_tournament_fees238()','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.guard_tournament_fees238()','EXECUTE');
 ASSERT (SELECT tgenabled='O' AND tgfoid='floor_private.guard_tournament_fees238()'::regprocedure FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_fee_integrity238');
END $$;
'@
$taskSql=$taskPre+"`nSELECT set_config('vinpoker.tournament404_before',($taskFacts),true);`n"+$taskBody+"`n"+$taskPost+"`nDO `$`$ BEGIN ASSERT current_setting('vinpoker.tournament404_before')=($taskFacts);END `$`$;`nCOMMIT;"
$taskSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'tournament404 install failed/rolled back'}
Write-Output 'TOURNAMENT404_LOCAL238_INSTALLED_FIVE_TABLE_FACTS_UNCHANGED_NO_LEDGER'
