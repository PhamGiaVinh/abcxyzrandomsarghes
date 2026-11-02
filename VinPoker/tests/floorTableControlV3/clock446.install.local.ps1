param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'LOCAL -Apply opt-in required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000243_clock_adjust_read_consistency_v1.sql'
if((Get-FileHash $taskPath -Algorithm SHA256).Hash -ne '4458DDEEE1D94608D26F216A10EE49A51AE849E21D27B0B0F7204FDF8F85AE4A'){throw 'clock243 source drift'}
$taskBody=[regex]::Replace((Get-Content $taskPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskPre=@'
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000243');
END $$;
CREATE TEMP TABLE clock_before446 ON COMMIT DROP AS SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a),
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p)) AS value;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT value FROM clock_before446) IS NOT DISTINCT FROM jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a),
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p));
 ASSERT (SELECT count(*) FROM floor_private.clock_control_backup243)=1;
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.clock_control_backup243'::regclass);
 ASSERT NOT has_table_privilege('authenticated','floor_private.clock_control_backup243','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.clock_control_backup243','SELECT');
 ASSERT NOT has_function_privilege('anon','public.floor_control_tournament_clock(uuid,text,integer,text)','EXECUTE');
END $$;
SELECT after_body_md5 FROM floor_private.clock_control_backup243 WHERE id;
COMMIT;
'@
($taskPre+"`n"+$taskBody+"`n"+$taskPost) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'clock446 local install failed/rolled back'}
Write-Output 'CLOCK446_LOCAL243_INSTALLED_TOUR_AUDIT_HAND_PRIZE_UNCHANGED_NO_LEDGER'
