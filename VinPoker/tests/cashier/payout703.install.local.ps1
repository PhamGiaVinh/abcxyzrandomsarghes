param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit LOCAL-only -Apply required'}
$taskFile=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000277_payout_manual_edit_intent_v1.sql'
if((Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash -ne '60B6A5FD625CA4022238B4E8F8B2818F35E174EA7CA2664423229EE13F684FB3'){throw 'Candidate277 source drift'}
$taskSource=Get-Content -LiteralPath $taskFile -Raw
if(([regex]::Matches($taskSource,'(?m)^BEGIN;\r?$')).Count-ne1 -or ([regex]::Matches($taskSource,'(?m)^COMMIT;\r?$')).Count-ne1){throw 'Unexpected transaction shape'}
$taskBody=[regex]::Replace($taskSource,'(?m)^(BEGIN|COMMIT);\r?$','')
$taskPre=@'
BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000277');
 ASSERT to_regclass('floor_private.payout703_local_recovery') IS NULL;
END $$;
CREATE TABLE floor_private.payout703_local_recovery AS SELECT
 pg_get_functiondef('public.save_tournament_prizes_v2(uuid,jsonb,text)'::regprocedure) AS definition,
 (SELECT proacl FROM pg_proc WHERE oid='public.save_tournament_prizes_v2(uuid,jsonb,text)'::regprocedure) AS acl,
 now() AS captured_at;
ALTER TABLE floor_private.payout703_local_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.payout703_local_recovery FROM PUBLIC,anon,authenticated,service_role;
CREATE TEMP TABLE business703 ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_payout_runs x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prizes x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x))::text) AS fingerprint;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM business703)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_payout_runs x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prizes x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x))::text);
 ASSERT (SELECT count(*)=0 FROM floor_private.payout_manual_edit_receipts_v1);
 ASSERT (SELECT count(*)=1 AND bool_and(md5(replace(definition,chr(13),''))='d00da78c8b4e3fd1e6f3431bac98ef5c') FROM floor_private.payout703_local_recovery);
 ASSERT NOT has_table_privilege('authenticated','floor_private.payout703_local_recovery','SELECT');
 ASSERT NOT has_table_privilege('anon','floor_private.payout703_local_recovery','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.payout703_local_recovery','SELECT');
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000277');
END $$;
COMMIT;
'@
($taskPre+"`n"+$taskBody+"`n"+$taskPost) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne0){throw 'Local candidate277 installation failed/rolled back'}
Write-Output 'PAYOUT703_LOCAL277_INSTALLED_PRIVATE_RECOVERY_BUSINESS_UNCHANGED_NO_LEDGER'
