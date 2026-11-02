$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
function Invoke-Fnb725Sql([string]$query) {
  $result = $query | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'FNB725 native SQL failed, transaction disconnect rolls back' }
  return $result
}
$migration = Get-Content -Raw supabase/migrations/20270128000278_fnb_order_event_integrity_v1.sql
if ([regex]::Matches($migration, '(?m)^COMMIT;\r?$').Count -ne 1) { throw 'Unexpected migration boundary' }
$migration = [regex]::Replace($migration, '(?m)^COMMIT;\r?\n?', '')
$sql = "\set ON_ERROR_STOP on`n" + $migration + "`nSET LOCAL test.fnb722_rollback='on';SET LOCAL test.fnb725_rollback='on';`n" +
  (Get-Content -Raw tests/cashier/fnb722.shift-backend.candidate.sql) + "`n" +
  (Get-Content -Raw tests/cashier/fnb725.intent-recovery.candidate.sql) + "`n" +
  (Get-Content -Raw tests/cashier/fnb725.intent-case.sql) + "`nROLLBACK;`n"
$postcheck = @'
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL;
 ASSERT to_regclass('floor_private.fnb_shift_intents722') IS NULL;
 ASSERT to_regprocedure('public.fnb_open_shift_v2(uuid,bigint,text,uuid)') IS NULL;
 ASSERT to_regprocedure('floor_private.fnb_open_shift_core725(uuid,bigint,text)') IS NULL;
 ASSERT to_regprocedure('public.fnb_cancel_shift_intent_v1(uuid,text,uuid,bigint,text,text,uuid)') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='LOCAL725 intent rollback TEST');
 ASSERT md5(pg_get_functiondef('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure))='53b74527ffe2f57df8b82ed6dc8e53b3';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid());
END $$;
ROLLBACK;
SELECT 'FNB725_INTENT_SCHEMA_FIXTURE_AND_CORE_ROLLBACK_POSTCHECK_PASS';
'@
$postcheck += "`n" + (Get-Content -Raw tests/cashier/fnb718.postcheck.readonly.sql)
try { Invoke-Fnb725Sql $sql }
finally { Invoke-Fnb725Sql $postcheck }
