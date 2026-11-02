param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'LOCAL-only opt-in -Apply required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000240_tournament_blind_level_integrity_v1.sql'
if((Get-FileHash $taskPath -Algorithm SHA256).Hash -ne '8D4EAC7603420ABB7FCBF71A50ACF6AE42EBAD7176CB70BD053215858D31E1E1'){throw 'reviewed240 source drift'}
$taskBody=[regex]::Replace((Get-Content $taskPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskPre=@'
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000240');
 ASSERT to_regprocedure('floor_private.guard_tournament_blinds240()') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_levels'::regclass AND tgname='trg_tournament_blind_integrity240');
END $$;
CREATE TEMP TABLE before415 ON COMMIT DROP AS SELECT jsonb_agg(to_jsonb(l) ORDER BY id) AS rows FROM public.tournament_levels l;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_blinds240()'::regprocedure)='f6d7d369d7cf04e154750bd676370333';
 ASSERT (SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='floor_private.guard_tournament_blinds240()'::regprocedure);
 ASSERT NOT has_function_privilege('anon','floor_private.guard_tournament_blinds240()','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.guard_tournament_blinds240()','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.guard_tournament_blinds240()','EXECUTE');
 ASSERT (SELECT tgenabled='O' AND tgfoid='floor_private.guard_tournament_blinds240()'::regprocedure FROM pg_trigger WHERE tgrelid='public.tournament_levels'::regclass AND tgname='trg_tournament_blind_integrity240');
 ASSERT (SELECT rows FROM before415) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l);
END $$;
COMMIT;
'@
($taskPre+"`n"+$taskBody+"`n"+$taskPost) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'blinds415 local install failed/rolled back'}
Write-Output 'BLINDS415_LOCAL240_INSTALLED_ALL_LEVEL_ROWS_UNCHANGED_NO_LEDGER'
