param([switch]$Candidate,[switch]$Recovery,[switch]$Installed)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
$case=Get-Content -Raw tests/cashier/cashier746.historical-receipt.rollback.sql
if($Installed){
 if($Candidate-or$Recovery){throw 'Installed verification cannot reapply/rollback historical candidate'}
 $case=$case.Replace("='6ffe6a9e0fd924ee30f5ea92e7a213b1'","='6a408d9aedd50d07b83cd6643d6e3732'")
}
if($Candidate){
 $migration=Get-Content -Raw supabase/migrations/20270128000285_cashier_terminal_receipt_history_v1.sql
 if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected migration transaction boundaries'}
 $case=$case.Replace('-- CASHIER746_CANDIDATE',[regex]::Replace($migration,'(?m)^(BEGIN|COMMIT);\r?\n?',''))
}
if($Recovery){
 if(-not $Candidate){throw 'Recovery qualification requires candidate'}
 $recoverySql=Get-Content -Raw docs/emergency_rollbacks/20270128000285_cashier_terminal_receipt_read.sql
 $case=$case.Replace('ROLLBACK;',[regex]::Replace($recoverySql,'(?m)^(BEGIN|COMMIT);\r?\n?','')+"`nROLLBACK;")
}
$case | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'Cashier746 native qualification failed; disconnected outer transaction rolls back'}
