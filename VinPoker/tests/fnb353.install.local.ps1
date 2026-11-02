param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit isolated local -Apply required'}
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$taskMigration=(Get-Content -LiteralPath 'supabase/migrations/20270128000231_fnb_guest_status_bank_snapshot_v1.sql' -Raw) -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^COMMIT;\r?$',''
$task351=(Get-Content -LiteralPath 'tests/fnb351.bankSnapshot.rollback.sql' -Raw) -replace '(?m)^BEGIN;\r?$','' -replace '(?m)^ROLLBACK;\r?$',''
$task352=Get-Content -LiteralPath 'tests/fnb352.statusSnapshot.rollback.sql' -Raw
$taskRecovery=Get-Content -LiteralPath 'tests/fnb353.recover.local.sql' -Raw
$taskPrefix=@'
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'))
 THEN RAISE EXCEPTION 'exact_local353_only';END IF;
END $$;
CREATE TEMP VIEW fnb353_fingerprint AS SELECT md5(jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x),
 'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x),
 'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY token_id,request_id) FROM floor_private.fnb_guest_request_receipts_v1 x),
 'bank',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.platform_bank_accounts x),
 'qr',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_table_qr_tokens x),
 'settings',(SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id) FROM public.fnb_settings x),
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text) fingerprint;
CREATE TEMP TABLE fnb353_before AS SELECT * FROM fnb353_fingerprint;
'@
$taskSuffix=@'
DO $$ BEGIN
 IF (SELECT fingerprint FROM fnb353_before) IS DISTINCT FROM (SELECT fingerprint FROM fnb353_fingerprint)
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure)<>'2dec3d76331a32a7d5a912e2b2c710b5'
 OR (SELECT proacl FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure) IS DISTINCT FROM (SELECT acl FROM floor_private.fnb_guest_status_release_backup231)
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure AND prosecdef AND provolatile='s' AND proconfig @>ARRAY['search_path=""'])
 OR has_table_privilege('anon','floor_private.fnb_guest_status_release_backup231','SELECT')
 OR NOT(SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.fnb_guest_status_release_backup231'::regclass)
 THEN RAISE EXCEPTION 'local353_postcheck_failed';END IF;
END $$;
SELECT 'LOCAL_FNB231_STATUS_INSTALLED_BACKUP_RECOVERY_BUSINESS_UNCHANGED_NO_LEDGER';
COMMIT;
'@
($taskPrefix+"`n"+$taskMigration+"`nSAVEPOINT case351;`n"+$task351+"`nROLLBACK TO case351;`nSAVEPOINT case352;`n"+$task352+"`nROLLBACK TO case352;`nSAVEPOINT recover353;`n"+$taskRecovery+"`nROLLBACK TO recover353;`n"+$taskSuffix) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'local353 install failed; inspect before retry'}
