param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'LOCAL-only -Apply opt-in required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000241_tournament_blind_replace_shape_v1.sql'
if((Get-FileHash $taskPath -Algorithm SHA256).Hash -ne 'E37871D9615B6FC8ACE57BA20CE3C83ADDEFE36B32304EB597B9CB95BB4DF17C'){throw 'reviewed241 source drift'}
$taskBody=[regex]::Replace((Get-Content $taskPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskPre=@'
BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000241');
END $$;
CREATE TEMP TABLE before417 ON COMMIT DROP AS SELECT jsonb_agg(to_jsonb(l) ORDER BY id) AS rows FROM public.tournament_levels l;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure)='cd7c7f07cecb78328bb3637f60111add';
 ASSERT (SELECT rows FROM before417) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l);
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.blind_structure_update_backup241'::regclass);
 ASSERT NOT has_table_privilege('anon','floor_private.blind_structure_update_backup241','SELECT');
 ASSERT NOT has_table_privilege('authenticated','floor_private.blind_structure_update_backup241','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.blind_structure_update_backup241','SELECT');
 ASSERT (SELECT count(*)=1 FROM floor_private.blind_structure_update_backup241);
END $$;
COMMIT;
'@
($taskPre+"`n"+$taskBody+"`n"+$taskPost) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'blinds417 install failed/rolled back'}
Write-Output 'BLINDS417_LOCAL241_INSTALLED_LEVELS_UNCHANGED_PRIVATE_RECOVERY_NO_LEDGER'
