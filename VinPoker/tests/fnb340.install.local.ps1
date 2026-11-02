param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit isolated local -Apply required'}
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$taskMigration=(Get-Content -LiteralPath 'supabase/migrations/20270128000229_fnb_guest_order_receipt_read_v1.sql' -Raw) -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^COMMIT;\r?$',''
$taskTest=Get-Content -LiteralPath 'tests/fnb336.receiptRead.rollback.sql' -Raw
$taskRecovery=Get-Content -LiteralPath 'tests/fnb340.recover.local.sql' -Raw
$taskPrefix=@'
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'))
 OR to_regprocedure('public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'exact_local340_precondition';END IF;
END $$;
CREATE TEMP VIEW fnb340_fingerprint AS SELECT md5(jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x),
 'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x),
 'events',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_events x),
 'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY token_id,request_id) FROM floor_private.fnb_guest_request_receipts_v1 x),
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text) fingerprint;
CREATE TEMP TABLE fnb340_before AS SELECT * FROM fnb340_fingerprint;
'@
$taskSuffix=@'
DO $$ BEGIN
 IF (SELECT fingerprint FROM fnb340_before) IS DISTINCT FROM (SELECT fingerprint FROM fnb340_fingerprint)
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)'::regprocedure)<>'7d88cb039763da1b2135e79d80368529'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text)'::regprocedure)<>'6ad2faf30241557404a88af898b1e8b7'
 THEN RAISE EXCEPTION 'local340_postcheck_failed';END IF;
END $$;
SELECT 'LOCAL_FNB229_READER_INSTALLED_NO_LEDGER_BUSINESS_UNCHANGED';
COMMIT;
'@
($taskPrefix+"`n"+$taskMigration+"`n"+$taskTest+"`nSAVEPOINT recover340;`n"+$taskRecovery+"`nROLLBACK TO recover340;`n"+$taskSuffix) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'local340 install failed; inspect before retry'}
