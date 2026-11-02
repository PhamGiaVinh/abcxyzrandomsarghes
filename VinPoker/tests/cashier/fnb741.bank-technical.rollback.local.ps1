param([switch]$Candidate,[switch]$Canonical,[switch]$Recovery)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
function Invoke-Fnb741([string]$query){
 $result=$query | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_fnb719_gate_local psql -w -X -qAt -v ON_ERROR_STOP=1
 if($LASTEXITCODE-ne 0){throw 'FNB741 qualification failed; disconnected outer transaction rolls back'}
 return $result
}
$proof=@'
BEGIN READ ONLY;
SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(jsonb_build_array(pg_get_functiondef(oid),proowner,proacl,proconfig) ORDER BY oid) FROM pg_proc WHERE oid IN('public.settle_bank_transaction(uuid,boolean)'::regprocedure,'public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure)),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.payment_settlements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.bank_transactions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_orders x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_stock_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_ingredients x)
)::text);
ROLLBACK;
'@
$before=Invoke-Fnb741 $proof
try{
 $case=Get-Content -Raw tests/cashier/fnb741.bank-technical.rollback.sql
 if($Candidate -or $Canonical){
  $candidateSql=Get-Content -Raw tests/cashier/fnb741.bank-technical.candidate.sql
  if($Canonical){
   $candidateSql=Get-Content -Raw supabase/migrations/20270128000284_fnb_bank_technical_failure_v1.sql
   if([regex]::Matches($candidateSql,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($candidateSql,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected canonical transaction boundary'}
   $candidateSql=[regex]::Replace($candidateSql,'(?m)^(BEGIN|COMMIT);\r?\n?','')
  }
  $case=$case.Replace('-- FNB741_CANDIDATE',$candidateSql)
 }
 if($Recovery){
  if(-not $Canonical){throw 'Recovery qualification requires exact canonical candidate'}
  $recoverySql=Get-Content -Raw docs/emergency_rollbacks/20270128000284_fnb_suspend_bank_technical.sql
  if([regex]::Matches($recoverySql,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($recoverySql,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected recovery transaction boundary'}
  $recoverySql=[regex]::Replace($recoverySql,'(?m)^(BEGIN|COMMIT);\r?\n?','')
  $case=$case.Replace('ROLLBACK;',$recoverySql+"`nROLLBACK;")
 }
 Invoke-Fnb741 $case
}finally{
 $after=Invoke-Fnb741 $proof
 if(($before -join "`n")-cne($after -join "`n")){throw 'FNB741 original definitions and bank/order/stock/audit changed'}
 Write-Output 'FNB741_ORIGINAL_DEFINITIONS_FAILED720_AND_ALL_BANK_ORDER_STOCK_AUDIT_RESTORED'
}
