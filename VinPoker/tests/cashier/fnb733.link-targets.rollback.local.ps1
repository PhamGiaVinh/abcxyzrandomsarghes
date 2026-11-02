param([switch]$Baseline,[switch]$Installed)
$ErrorActionPreference='Stop'
if($Baseline -and $Installed){throw 'Choose baseline or installed, not both'}
Set-Location (Join-Path $PSScriptRoot '../..')
function Invoke-Fnb733Sql([string]$query) {
 $result=$query | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'FNB733 native assertion failed; disconnected transaction rolls back'}
 return $result
}
$proof=@'
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='LOCAL733 canonical FNB reader rollback TEST');
END $$;
SELECT md5(jsonb_build_array(
 pg_get_functiondef('public.fnb_list_link_targets(uuid)'::regprocedure),
 (SELECT jsonb_agg(jsonb_build_array(proowner,proacl,proconfig)) FROM pg_proc WHERE oid='public.fnb_list_link_targets(uuid)'::regprocedure),
 (SELECT count(*) FROM public.tournament_seats),(SELECT count(*) FROM public.table_sessions),
 (SELECT count(*) FROM public.fnb_orders),(SELECT count(*) FROM public.fnb_order_events),
 (SELECT count(*) FROM public.fnb_stock_movements),(SELECT count(*) FROM auth.users)
)::text);
ROLLBACK;
'@
$before=Invoke-Fnb733Sql $proof
$sql="BEGIN;`n"
if($Baseline){
 $sql+="DO `$`$ BEGIN ASSERT md5(pg_get_functiondef('public.fnb_list_link_targets(uuid)'::regprocedure))='638cb830a272e4cbcc897fdb6aa0bd65','baseline consumed; do not reset installed reader'; END `$`$;`n"
}
if($Installed){
 $sql+="DO `$`$ BEGIN ASSERT md5(pg_get_functiondef('public.fnb_list_link_targets(uuid)'::regprocedure))='1355b19894cc94e6433200cf56fd159b','installed reader drift'; END `$`$;`n"
}
if(-not $Baseline -and -not $Installed){
 $migration=Get-Content -Raw supabase/migrations/20270128000280_fnb_canonical_link_targets_v1.sql
 if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected transaction boundaries'}
 $sql=[regex]::Replace($migration,'(?m)^COMMIT;\r?\n?','')+"`n"
}
$sql+=(Get-Content -Raw tests/cashier/fnb733.link-targets.case.sql)+"`nROLLBACK;"
try{Invoke-Fnb733Sql $sql}finally{
 if((Invoke-Fnb733Sql $proof)-ne $before){throw 'FNB733 original function/ACL/business/identity facts changed'}
}
Write-Host 'FNB733_NATIVE_CANONICAL_READ_AND_FULL_ROLLBACK_PASS'
