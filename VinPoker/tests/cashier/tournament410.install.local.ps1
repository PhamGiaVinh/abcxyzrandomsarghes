param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'LOCAL-only opt-in -Apply required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000239_tournament_player_count_write_integrity_v1.sql'
if((Get-FileHash $taskPath -Algorithm SHA256).Hash -ne 'B162212E2D5F852014BA03A463396002FE1C5F1323E25321088BF61F96E4E9D2'){throw 'reviewed239 source drift'}
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
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000239');
 ASSERT to_regprocedure('floor_private.guard_tournament_players239()') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_players_integrity239');
END $$;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_players239()'::regprocedure)='2339b79e35f0b84d12c0cc30fde22265';
 ASSERT (SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='floor_private.guard_tournament_players239()'::regprocedure);
 ASSERT NOT has_function_privilege('anon','floor_private.guard_tournament_players239()','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.guard_tournament_players239()','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.guard_tournament_players239()','EXECUTE');
 ASSERT (SELECT tgenabled='O' AND tgfoid='floor_private.guard_tournament_players239()'::regprocedure FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_players_integrity239');
END $$;
'@
$taskSql=$taskPre+"`nSELECT set_config('vinpoker.tournament410_before',($taskFacts),true);`n"+$taskBody+"`n"+$taskPost+"`nDO `$`$ BEGIN ASSERT current_setting('vinpoker.tournament410_before')=($taskFacts);END `$`$;`nCOMMIT;"
$taskSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'tournament410 install failed/rolled back'}
Write-Output 'TOURNAMENT410_LOCAL239_INSTALLED_FIVE_TABLE_FACTS_UNCHANGED_NO_LEDGER'
