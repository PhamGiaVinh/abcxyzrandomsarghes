$ErrorActionPreference = 'Stop'
$payoutProject = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$payoutMigration = [IO.File]::ReadAllText((Join-Path $payoutProject 'supabase/migrations/20261103131615_payout_publication_after_cashier.sql'))
# Remove only the migration's outer transaction statements so its DDL and tests
# live in one rollback. This runner has no production endpoint or credentials.
$payoutMigration = [regex]::Replace($payoutMigration, '(?m)^(BEGIN|COMMIT);\r?$', '')
$payoutTest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'payoutPublication.rollback.local.sql'))
$payoutRecovery = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'payoutPublication.forward-rollback.sql'))
$payoutRecovery = [regex]::Replace($payoutRecovery, '(?m)^(BEGIN|COMMIT);\r?$', '')
$payoutSql = @'
\set ON_ERROR_STOP on
BEGIN;
DO $$BEGIN
 ASSERT current_database()='vinpoker_earlyitm1172_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
END $$;
'@ + "`n" + $payoutMigration + "`n" + $payoutTest + "`n" + $payoutRecovery + @'

ROLLBACK;
DO $$BEGIN
 ASSERT to_regprocedure('public.get_floor_tournament_prize_results_v1(uuid)') IS NULL;
 ASSERT md5(replace(pg_get_functiondef('public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)'::regprocedure),chr(13),''))='c23a5810b1307994c1b3428958bd92e0';
END $$;
SELECT 'PAYOUT_PUBLICATION_NATIVE_ROLLBACK_PASS';
'@
$payoutSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_earlyitm1172_local psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Payout publication native test failed; transaction was not committed.' }
