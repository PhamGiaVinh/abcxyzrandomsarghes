$ErrorActionPreference = 'Stop'
$financeProject = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$financeSql = @'
\set ON_ERROR_STOP on
BEGIN;
DO $$BEGIN
 ASSERT current_database()='vinpoker_earlyitm1172_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
END $$;
'@
foreach ($financeFile in @('20261103131615_payout_publication_after_cashier.sql','20261103153245_player_financial_reports_v1.sql')) {
 $financeSource = [IO.File]::ReadAllText((Join-Path $financeProject "supabase/migrations/$financeFile"))
 $financeSql += "`n" + [regex]::Replace($financeSource, '(?m)^(BEGIN|COMMIT);\r?$', '')
}
$financeSql += "`n" + [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'playerFinance.rollback.local.sql')) + @'

ROLLBACK;
DO $$BEGIN
 ASSERT to_regprocedure('public.get_owner_player_financial_report_v1(uuid,uuid,text,integer,integer)') IS NULL;
 ASSERT to_regprocedure('public.get_public_player_paid_winnings_v1(uuid)') IS NULL;
 ASSERT md5(replace(pg_get_functiondef('public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)'::regprocedure),chr(13),''))='c23a5810b1307994c1b3428958bd92e0';
END $$;
SELECT 'PLAYER_FINANCE_NATIVE_ROLLBACK_PASS';
'@
$financeSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_earlyitm1172_local psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Player finance native rollback test failed.' }
