param([switch]$Candidate)
$ErrorActionPreference='Stop'
if($env:VINPOKER_SWING830_ROLLBACK -ne '1'){throw 'Explicit LOCAL830 rollback mode required'}
$taskTest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manualSwing830.terminal-error.rollback.sql') -Raw
if($Candidate){
 $taskCandidate=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../supabase/migrations/20270128000293_dealer_swing_error_atomic_v1.sql') -Raw
 $taskCandidate=$taskCandidate.Replace("`r`n","`n")
 if(($taskCandidate -split "`nBEGIN;").Count -ne 2 -or $taskCandidate -notmatch 'COMMIT;\s*$'){throw 'Unexpected candidate transaction shape'}
 $taskCandidate=$taskCandidate.Replace("`nBEGIN;","`n") -replace 'COMMIT;\s*$',''
 $taskAnchor="SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';"
 if(($taskTest -split [regex]::Escape($taskAnchor)).Count -ne 2){throw 'Unexpected test transaction anchor'}
 # Test's exact loopback/database/comment guard runs before this insertion.
 $taskTest=$taskTest.Replace($taskAnchor,$taskAnchor+"`n"+$taskCandidate)
}
$taskTest | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_checkout814_race_local psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'LOCAL830 regression failed; disconnected transaction rolls back'}
