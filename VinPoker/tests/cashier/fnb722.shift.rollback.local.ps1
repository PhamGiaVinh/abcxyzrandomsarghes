$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
function Invoke-Fnb722Sql([string]$query) {
  $result = $query | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'FNB722 native SQL failed; disconnected transaction rolls back' }
  return $result
}
$proof = @'
BEGIN READ ONLY;
SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_orders x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_order_items x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_order_events x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_stock_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_ingredients x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.bank_transactions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.payment_settlements x),
 (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) ORDER BY p.oid)
  FROM pg_proc p WHERE p.proname IN('fnb_mark_paid','fnb_cancel_order','fnb_settle_bank_paid','fnb_create_comp_order'))
)::text);
ROLLBACK;
'@
$before = Invoke-Fnb722Sql $proof
$migration = Get-Content -Raw supabase/migrations/20270128000278_fnb_order_event_integrity_v1.sql
if ([regex]::Matches($migration, '(?m)^COMMIT;\r?$').Count -ne 1) { throw 'Unexpected migration boundary' }
$migration = [regex]::Replace($migration, '(?m)^COMMIT;\r?\n?', '')
$candidate = Get-Content -Raw tests/cashier/fnb722.shift-backend.candidate.sql
$cases = Get-Content -Raw tests/cashier/fnb722.shift-case.sql
$sql = "\set ON_ERROR_STOP on`n" + $migration + "`nSET LOCAL test.fnb722_rollback='on';`n" + $candidate + "`n" + $cases + "`nROLLBACK;`n"
$postcheck = @'
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL;
 ASSERT to_regclass('floor_private.fnb_shift_order_events722') IS NULL;
 ASSERT to_regclass('floor_private.fnb_shift_intents722') IS NULL;
 ASSERT to_regprocedure('public.fnb_open_shift(uuid,bigint,text)') IS NULL;
 ASSERT md5(pg_get_functiondef('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure))='53b74527ffe2f57df8b82ed6dc8e53b3';
 ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='LOCAL722 rollback TEST');
 ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN('fnb_shift_event722','fnb_shift_frozen722'));
END $$;
ROLLBACK;
SELECT 'FNB722_SCHEMA_COMP_TRIGGER_FIXTURE_ROLLBACK_POSTCHECK_PASS';
'@
$postcheck += "`n" + (Get-Content -Raw tests/cashier/fnb718.postcheck.readonly.sql)
try { Invoke-Fnb722Sql $sql }
finally {
  Invoke-Fnb722Sql $postcheck
  $after = Invoke-Fnb722Sql $proof
  if ($after -ne $before) { throw 'FNB722 original business/function/authority fingerprint changed' }
  Write-Output 'FNB722_ORIGINAL_BUSINESS_AND_FOUR_WRITER_AUTHORITY_FINGERPRINT_UNCHANGED'
}
