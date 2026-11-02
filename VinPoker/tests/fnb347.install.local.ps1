param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit isolated local -Apply required'}
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$taskMigration=(Get-Content -LiteralPath 'supabase/migrations/20270128000230_fnb_guest_abandon_intent_v1.sql' -Raw) -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^COMMIT;\r?$',''
$taskTest=Get-Content -LiteralPath 'tests/fnb346.abandon.rollback.sql' -Raw
$taskRecovery=Get-Content -LiteralPath 'tests/fnb347.recover.local.sql' -Raw
$taskPrefix=@'
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'))
 THEN RAISE EXCEPTION 'exact_local347_only';END IF;
END $$;
CREATE TEMP VIEW fnb347_fingerprint AS SELECT md5(jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x),
 'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x),
 'events',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_events x),
 'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY token_id,request_id) FROM floor_private.fnb_guest_request_receipts_v1 x),
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text) fingerprint;
CREATE TEMP TABLE fnb347_before AS SELECT * FROM fnb347_fingerprint;
'@
$taskRehearsal=@'
DO $$
DECLARE r floor_private.fnb_guest_request_receipts_v1;token text;result jsonb;
BEGIN
 SELECT * INTO STRICT r FROM floor_private.fnb_guest_request_receipts_v1 WHERE order_id IS NULL AND payload->>'customer_name'='TEST346' LIMIT 1;
 SELECT t.token INTO STRICT token FROM public.fnb_table_qr_tokens t WHERE t.id=r.token_id;
 result:=public.fnb_guest_create_order(token,(r.payload->>'seat')::smallint,r.payload->>'customer_name',r.payload->>'note',r.payload->'lines',r.payload->>'payment_method',r.request_id);
 IF result->>'error' IS DISTINCT FROM 'REQUEST_ABANDONED' THEN RAISE EXCEPTION 'recovery347_lost_fence';END IF;
END $$;
'@
$taskSuffix=@'
DO $$ BEGIN
 IF (SELECT fingerprint FROM fnb347_before) IS DISTINCT FROM (SELECT fingerprint FROM fnb347_fingerprint)
 OR has_function_privilege('service_role','public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)','EXECUTE')
 OR NOT has_function_privilege('anon','public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)','EXECUTE')
 OR has_table_privilege('anon','floor_private.fnb_guest_request_receipts_v1','SELECT')
 OR NOT(SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.fnb_guest_request_receipts_v1'::regclass)
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='floor_private.fnb_guest_request_receipts_v1'::regclass AND conname='fnb_guest_receipt_terminal230' AND convalidated)
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)'::regprocedure AND prosecdef AND proconfig @>ARRAY['search_path=""'])
 THEN RAISE EXCEPTION 'local347_postcheck_failed';END IF;
END $$;
SELECT 'LOCAL_FNB230_INSTALLED_RECOVERY_FENCE_PRESERVED_NO_BUSINESS_DELTA_NO_LEDGER';
COMMIT;
'@
($taskPrefix+"`n"+$taskMigration+"`nSAVEPOINT rehearsal347;`n"+$taskTest+"`n"+$taskRecovery+"`n"+$taskRehearsal+"`nROLLBACK TO rehearsal347;`n"+$taskSuffix) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'local347 install failed; inspect before retry'}
