$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
function Invoke-Fnb741Primary([string]$query){
 $result=$query | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
 if($LASTEXITCODE-ne 0){throw 'FNB741 primary LOCAL failed'}
 return $result
}
$proof=@'
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.bank_transactions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.payment_settlements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_orders x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_stock_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_ingredients x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_seats x)
)::text);
ROLLBACK;
'@
$before=Invoke-Fnb741Primary $proof
$migration=Get-Content -Raw supabase/migrations/20270128000284_fnb_bank_technical_failure_v1.sql
if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected migration boundaries'}
$migration=[regex]::Replace($migration,'(?m)^(BEGIN|COMMIT);\r?\n?','')
$prefix=@'
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.fnb_bank_parent_backup741') IS NULL,'LOCAL741 installer consumed';
END $$;
CREATE TABLE floor_private.fnb_bank_parent_backup741 AS
 SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig,prosecdef
 FROM pg_proc WHERE oid='public.settle_bank_transaction(uuid,boolean)'::regprocedure;
ALTER TABLE floor_private.fnb_bank_parent_backup741 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_bank_parent_backup741 FROM PUBLIC,anon,authenticated,service_role;
'@
$suffix=@'
DO $$ BEGIN
 ASSERT (SELECT count(*)=1 FROM floor_private.fnb_bank_parent_backup741);
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000284');
 ASSERT md5(pg_get_functiondef('public.settle_bank_transaction(uuid,boolean)'::regprocedure))='a168fe83773001f1f448e25ff2aab3ab';
END $$;
COMMIT;
'@
Invoke-Fnb741Primary ($prefix+"`n"+$migration+"`n"+$suffix)
$after=Invoke-Fnb741Primary $proof
if(($before -join "`n")-cne($after -join "`n")){throw 'LOCAL741 business facts changed unexpectedly'}
Write-Output 'FNB741_LOCAL_PRIMARY_EXACT284_PRIVATE_ORIGINAL_AUTHORITY_BACKUP_NO_LEDGER_NO_BUSINESS_DELTA_PASS'
