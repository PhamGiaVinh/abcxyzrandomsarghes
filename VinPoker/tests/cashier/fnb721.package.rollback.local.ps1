$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
function Remove-TransactionBoundary([string]$sql, [string]$finish) {
  if ([regex]::Matches($sql, '(?m)^BEGIN;\r?$').Count -ne 1 -or [regex]::Matches($sql, "(?m)^$finish;\r?$").Count -ne 1) { throw 'Unexpected transaction boundaries' }
  $sql = [regex]::Replace($sql, '(?m)^BEGIN;\r?\n', '')
  return [regex]::Replace($sql, "(?m)^$finish;\r?\n?", '')
}
$migration = Get-Content -Raw supabase/migrations/20270128000278_fnb_order_event_integrity_v1.sql
if ([regex]::Matches($migration, '(?m)^COMMIT;\r?$').Count -ne 1) { throw 'Unexpected migration commit count' }
$migration = [regex]::Replace($migration, '(?m)^COMMIT;\r?\n?', '')
$cash = Remove-TransactionBoundary (Get-Content -Raw tests/cashier/fnb718.cash-timestamp.rollback.sql) 'ROLLBACK'
$bank = Get-Content -Raw tests/cashier/fnb721.bank-package-case.sql
$suspend = Remove-TransactionBoundary (Get-Content -Raw docs/emergency_rollbacks/20270128000278_fnb_suspend_money_writes.sql) 'COMMIT'
$assertSuspended = @'
DO $$ DECLARE signature text; actor text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.fnb_mark_paid(uuid,text)','public.fnb_cancel_order(uuid,text)','public.fnb_settle_bank_paid(uuid,uuid)','public.settle_bank_transaction(uuid,boolean)'] LOOP
  FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   ASSERT NOT has_function_privilege(actor,signature,'EXECUTE'),signature||' exposed to '||actor;
  END LOOP;
 END LOOP;
END $$;
ROLLBACK;
SELECT 'FNB721_PACKAGE_CASH_BANK_REPLAY_SUSPENSION_ROLLBACK_PASS';
'@
$postcheck = @'
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT to_regprocedure('floor_private.fnb_cash_event_gate_v1(uuid)') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='LOCAL721 rollback TEST');
 ASSERT NOT EXISTS(SELECT 1 FROM public.bank_transactions WHERE provider_txn_id LIKE 'LOCAL721-%');
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_menu_items WHERE name='LOCAL721 rollback item');
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid());
END $$;
ROLLBACK;
SELECT 'FNB721_NO_CANONICAL_HELPER_FIXTURES_OR_IDLE_TRANSACTION';
'@
$sql = "\set ON_ERROR_STOP on`n\set FNB718_CANDIDATE false`n" + $migration + "`n" + $cash + "`n" + $bank + "`n" + $suspend + "`n" + $assertSuspended
$sql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'FNB721 qualification failed; disconnected transaction rolls back' }
Get-Content -Raw tests/cashier/fnb718.postcheck.readonly.sql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'FNB721 original writer postcheck failed' }
$postcheck | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'FNB721 fixture postcheck failed' }
