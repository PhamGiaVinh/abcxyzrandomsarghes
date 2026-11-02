param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit -Apply required for isolated LOCAL definitions only'}
Set-Location -LiteralPath (Join-Path $PSScriptRoot '../..')
$taskPrefix=@'
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c'
  OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
  OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
  OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
  OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'))
  OR to_regclass('floor_private.sepay301_definition_backup') IS NOT NULL
 THEN RAISE EXCEPTION 'sepay301_exact_isolated_local_required'; END IF;
END $$;
CREATE TEMP TABLE sepay301_before AS SELECT jsonb_build_object(
 'bank',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM public.bank_transactions t),
 'movement',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM public.cashier_buyin_movements t),
 'registration',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM public.tournament_registrations t),
 'entry',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM public.tournament_entries t),
 'seat',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM public.tournament_seats t),
 'settlement',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM public.payment_settlements t)) AS fingerprint;
CREATE TABLE floor_private.sepay301_definition_backup(signature text PRIMARY KEY,definition text NOT NULL,body_md5 text NOT NULL,acl text,owner_name text NOT NULL);
REVOKE ALL ON floor_private.sepay301_definition_backup FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE floor_private.sepay301_definition_backup ENABLE ROW LEVEL SECURITY;
INSERT INTO floor_private.sepay301_definition_backup
 SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid),md5(p.prosrc),p.proacl::text,pg_get_userbyid(p.proowner)
 FROM pg_proc p WHERE p.oid IN('public.manual_confirm_bank_transaction(uuid,uuid,text)'::regprocedure,
  'public.cashier_retry_paid_seating_v1(boolean,integer)'::regprocedure);
'@
$taskSql=$taskPrefix
foreach($taskName in @('20270128000225_cashier_sepay_intent_receipt_v1.sql','20270128000226_cashier_manual_bank_allocation_v1.sql','20270128000227_cashier_manual_bank_waiting_retry_v1.sql')){
 $taskSource=Get-Content -LiteralPath (Join-Path 'supabase/migrations' $taskName) -Raw
 if(($taskSource -split '(?m)^BEGIN;\r?$').Count-ne 2 -or $taskSource-notmatch 'COMMIT;\s*$'){throw "Unexpected transaction wrapper: $taskName"}
 $taskSql+="`n"+($taskSource -replace '(?m)^BEGIN;\r?$','' -replace 'COMMIT;\s*$','')
}
$taskSql+=@'

DO $$ BEGIN
 IF (SELECT count(*) FROM floor_private.sepay301_definition_backup)<>2
  OR has_function_privilege('anon','public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('service_role','public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.cashier_retry_paid_seating_v1(boolean,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'sepay301_acl_or_backup_failed'; END IF;
 IF EXISTS(SELECT 1 FROM floor_private.sepay301_definition_backup b JOIN pg_proc p ON p.oid=to_regprocedure(b.signature)
  WHERE p.proacl::text IS DISTINCT FROM b.acl OR pg_get_userbyid(p.proowner)<>b.owner_name) THEN
  RAISE EXCEPTION 'sepay301_existing_acl_changed'; END IF;
END $$;
-- Re-evaluate the identical fingerprint projection after DDL, not counts alone.
'@
$taskProjection=$taskPrefix.Substring($taskPrefix.IndexOf('CREATE TEMP TABLE sepay301_before AS SELECT '))
$taskProjection=$taskProjection.Substring(0,$taskProjection.IndexOf('CREATE TABLE floor_private.sepay301_definition_backup'))
$taskSql+="`n"+($taskProjection -replace 'sepay301_before','sepay301_after')
$taskSql+=@'
DO $$ BEGIN
 IF (SELECT fingerprint FROM sepay301_before) IS DISTINCT FROM (SELECT fingerprint FROM sepay301_after) THEN
  RAISE EXCEPTION 'sepay301_business_delta'; END IF;
END $$;
SELECT jsonb_build_object('status','LOCAL_DEFINITIONS_INSTALLED_NO_LEDGER','businessFingerprintUnchanged',true,
 'backupRows',(SELECT count(*) FROM floor_private.sepay301_definition_backup),
 'definitions',(SELECT jsonb_object_agg(proname,md5(prosrc)) FROM pg_proc WHERE oid IN(
  'public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)'::regprocedure,
  'public.manual_confirm_bank_transaction(uuid,uuid,text)'::regprocedure,
  'public.cashier_retry_paid_seating_v1(boolean,integer)'::regprocedure)));
COMMIT;
'@
$taskSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne 0){throw 'sepay301 local install failed; transaction must be inspected before retry'}
