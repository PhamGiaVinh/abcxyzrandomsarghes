$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
function Invoke-Cashier746([string]$query){
 $output=$query | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
 if($LASTEXITCODE-ne 0){throw 'Cashier746 local SQL failed'}
 return $output
}
$proof=@'
BEGIN READ ONLY;
SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.seat_draw_receipts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x)
)::text);
ROLLBACK;
'@
$before=Invoke-Cashier746 $proof
$migration=Get-Content -Raw supabase/migrations/20270128000285_cashier_terminal_receipt_history_v1.sql
if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected migration boundaries'}
$prefix=@'
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.cashier_worklist_backup746') IS NULL,'Cashier746 installer already consumed';
END $$;
CREATE TABLE floor_private.cashier_worklist_backup746 AS SELECT oid::regprocedure::text AS signature,
 pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig,prosecdef FROM pg_proc
 WHERE oid='public.cashier_tour_worklist_v1(uuid,uuid,text,text,integer,integer)'::regprocedure;
ALTER TABLE floor_private.cashier_worklist_backup746 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.cashier_worklist_backup746 FROM PUBLIC,anon,authenticated,service_role;
'@
Invoke-Cashier746 ($prefix+"`n"+[regex]::Replace($migration,'(?m)^(BEGIN|COMMIT);\r?\n?','')+"`nCOMMIT;")
$after=Invoke-Cashier746 $proof
if(($before -join "`n")-cne($after -join "`n")){throw 'Cashier746 business/receipt history changed'}
Write-Output 'CASHIER746_LOCAL_EXACT285_PRIVATE_OLD_DEFINITION_AUTHORITY_BACKUP_SIX_BUSINESS_TABLES_UNCHANGED_PASS'
