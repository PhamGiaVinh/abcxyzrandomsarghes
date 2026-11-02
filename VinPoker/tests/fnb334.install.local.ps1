param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit local-only -Apply required'}
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$taskMigration=(Get-Content -LiteralPath 'supabase/migrations/20270128000228_fnb_guest_intent_receipt_v1.sql' -Raw) -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^COMMIT;\r?$',''
$taskPrefix=@'
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'))
 THEN RAISE EXCEPTION 'exact_local334_required';END IF;
END $$;
CREATE TEMP VIEW fnb334_fingerprint AS SELECT md5(jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x),
 'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x),
 'events',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_events x),
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text) fingerprint;
CREATE TEMP TABLE fnb334_before AS SELECT * FROM fnb334_fingerprint;
'@
$taskSuffix=@'
DO $$ BEGIN
 IF (SELECT fingerprint FROM fnb334_before) IS DISTINCT FROM (SELECT fingerprint FROM fnb334_fingerprint) THEN RAISE EXCEPTION 'business334_delta';END IF;
 IF has_table_privilege('anon','floor_private.fnb_guest_request_receipts_v1','SELECT')
 OR has_function_privilege('anon','floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text)','EXECUTE')
 OR has_function_privilege('service_role','floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text)','EXECUTE')
 OR NOT(SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.fnb_guest_request_receipts_v1'::regclass)
 OR (SELECT count(*) FROM floor_private.fnb_guest_release_backup228)<>1
 THEN RAISE EXCEPTION 'private334_security_postcheck_failed';END IF;
END $$;
SELECT jsonb_build_object('status','LOCAL_FNB228_INSTALLED_NO_LEDGER','businessUnchanged',true,
 'wrapperBodyMd5',(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)'::regprocedure));
COMMIT;
'@
($taskPrefix+"`n"+$taskMigration+"`n"+$taskSuffix) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'fnb334 install failed; inspect transaction before retry'}
