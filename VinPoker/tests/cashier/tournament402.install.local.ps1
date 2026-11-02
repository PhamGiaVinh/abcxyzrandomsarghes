param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'LOCAL-only opt-in -Apply required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000237_tournament_guarantee_write_integrity_v1.sql'
if((Get-FileHash $taskPath -Algorithm SHA256).Hash -ne '18DEDD70E00B7BC38ECFC86051674731883EC5B1600BF2173BE7C8AA14F03655'){throw 'reviewed237 source drift'}
$taskBody=[regex]::Replace((Get-Content $taskPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskPre=@'
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000237');
 ASSERT to_regprocedure('floor_private.guard_tournament_guarantee237()') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_guarantee_integrity237');
END $$;
CREATE TEMP TABLE tournament402_before AS SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cashier_buyin_movements t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_entries t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_seats t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.notifications t)) facts;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_guarantee237()'::regprocedure)='01e390e92a028871a8fc762525a78470';
 ASSERT NOT has_function_privilege('anon','floor_private.guard_tournament_guarantee237()','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.guard_tournament_guarantee237()','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.guard_tournament_guarantee237()','EXECUTE');
 ASSERT (SELECT tgenabled='O' AND tgfoid='floor_private.guard_tournament_guarantee237()'::regprocedure FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_guarantee_integrity237');
 ASSERT (SELECT facts FROM tournament402_before)=jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cashier_buyin_movements t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_entries t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_seats t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.notifications t));
END $$;
COMMIT;
'@
($taskPre+"`n"+$taskBody+"`n"+$taskPost) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'tournament402 install failed/rolled back'}
Write-Output 'TOURNAMENT402_LOCAL237_INSTALLED_FIVE_TABLE_FACTS_UNCHANGED_NO_LEDGER'
