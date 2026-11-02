$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
function Invoke-Fnb727Sql([string]$query) {
  $result = $query | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'FNB727 canonical package failed; disconnected transaction rolls back' }
  return $result
}
function Remove-Fnb727Commit([string]$query,[bool]$removeBegin) {
  if ([regex]::Matches($query, '(?m)^COMMIT;\r?$').Count -ne 1 -or [regex]::Matches($query, '(?m)^BEGIN;\r?$').Count -ne 1) { throw 'Unexpected transaction boundary' }
  $query = [regex]::Replace($query, '(?m)^COMMIT;\r?\n?', '')
  if ($removeBegin) { $query = [regex]::Replace($query, '(?m)^BEGIN;\r?\n', '') }
  return $query
}
$sql = "\set ON_ERROR_STOP on`n" + (Remove-Fnb727Commit (Get-Content -Raw supabase/migrations/20270128000278_fnb_order_event_integrity_v1.sql) $false) + "`n" +
 (Remove-Fnb727Commit (Get-Content -Raw supabase/migrations/20270128000279_fnb_cash_shift_integrity_v1.sql) $true)
$case = Get-Content -Raw tests/cashier/fnb725.intent-case.sql
# Only prototype→canonical identifiers change, not a single assertion/outcome/fixture.
foreach ($identifier in @('fnb_shift_intents722','fnb_open_shift_core725')) {
  if ([regex]::Matches($case,$identifier).Count -ne 1) { throw 'Qualification identifier seam drift' }
}
$case = $case.Replace('fnb_shift_intents722','fnb_shift_intents_v1').Replace('fnb_open_shift_core725','fnb_open_shift_core_v1')
$sql += "`n" + $case + "`n" + (Remove-Fnb727Commit (Get-Content -Raw docs/emergency_rollbacks/20270128000279_fnb_suspend_cash_shift_writes.sql) $true)
$sql += @'

DO $$ DECLARE signature text;role_name text;BEGIN
 ASSERT md5(pg_get_functiondef('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure))='5e92d765ed352629a05eb98092d0b64d','canonical comp must match actual concurrency-qualified role recheck';
 FOREACH signature IN ARRAY ARRAY['public.fnb_open_shift_v2(uuid,bigint,text,uuid)','public.fnb_close_shift_v2(uuid,bigint,text,text,uuid)',
 'public.fnb_cancel_shift_intent_v1(uuid,text,uuid,bigint,text,text,uuid)','public.fnb_mark_paid(uuid,text)','public.fnb_cancel_order(uuid,text)',
 'public.fnb_settle_bank_paid(uuid,uuid)','public.settle_bank_transaction(uuid,boolean)','public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   ASSERT NOT has_function_privilege(role_name,signature,'EXECUTE'),signature||' exposed';
  END LOOP;
 END LOOP;
 ASSERT has_function_privilege('authenticated','public.fnb_get_shift_report(uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.fnb_get_shift_intent_v1(uuid,text,uuid)','EXECUTE');
END $$;
ROLLBACK;
SELECT 'FNB727_EXACT_FORWARD278_279_ACTOR_INTENT_CASH_AND_SUSPENSION_ROLLBACK_PASS';
'@
$postcheck = @'
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL;
 ASSERT to_regclass('floor_private.fnb_shift_intents_v1') IS NULL;
 ASSERT to_regclass('floor_private.fnb_shift_order_events_v1') IS NULL;
 ASSERT to_regprocedure('public.fnb_open_shift_v2(uuid,bigint,text,uuid)') IS NULL;
 ASSERT to_regprocedure('floor_private.fnb_open_shift_core_v1(uuid,bigint,text)') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='LOCAL725 intent rollback TEST');
 ASSERT md5(pg_get_functiondef('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure))='53b74527ffe2f57df8b82ed6dc8e53b3';
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN('20270128000278','20270128000279'));
END $$;
ROLLBACK;
SELECT 'FNB727_NO_CANONICAL_SHIFT_SCHEMA_FIXTURE_OR_LEDGER_ENTRY_RETAINED';
'@
$postcheck += "`n" + (Get-Content -Raw tests/cashier/fnb718.postcheck.readonly.sql)
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
  FROM pg_proc p WHERE p.proname IN('fnb_mark_paid','fnb_cancel_order','fnb_settle_bank_paid','fnb_create_comp_order','settle_bank_transaction'))
)::text);
ROLLBACK;
'@
$before = Invoke-Fnb727Sql $proof
try { Invoke-Fnb727Sql $sql }
finally {
 Invoke-Fnb727Sql $postcheck
 if ((Invoke-Fnb727Sql $proof) -ne $before) { throw 'FNB727 original business/function/authority fingerprint changed' }
 Write-Output 'FNB727_PRIMARY_SEVEN_TABLES_FIVE_FUNCTION_AUTHORITY_FINGERPRINT_UNCHANGED'
}
