param([switch]$Installed,[switch]$Receipt735,[switch]$ReceiptInstalled735,[switch]$Cancel737,[switch]$CancelInstalled737)
$ErrorActionPreference='Stop'
if($CancelInstalled737){if(-not $Installed -or -not $ReceiptInstalled735){throw 'Installed fence requires installed writer and reader'};$Cancel737=$true}
if($ReceiptInstalled735){if(-not $Installed){throw 'Installed receipt requires installed writer'};$Receipt735=$true}
Set-Location (Join-Path $PSScriptRoot '../..')
function Invoke-Fnb734Sql([string]$query){
 $value=$query | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
 if($LASTEXITCODE-ne 0){throw 'FNB734 native failed; disconnected outer transaction rolls back'}
 return $value
}
$proof=@'
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='LOCAL733 canonical FNB reader rollback TEST');
END $$;
SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(jsonb_build_array(pg_get_functiondef(oid),proowner,proacl,proconfig) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('fnb_create_order','fnb_list_link_targets','fnb_get_create_receipt_v1','_fnb_bind_create_intent_v1','fnb_cancel_create_intent_v1')),
 to_regclass('floor_private.fnb_create_cancel_fences_v1')::text,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_orders x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_order_items x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_order_events x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_create_intents_v1 x),
 (SELECT count(*) FROM public.tournament_seats),(SELECT count(*) FROM public.table_sessions),(SELECT count(*) FROM auth.users)
)::text);
ROLLBACK;
'@
$before=Invoke-Fnb734Sql $proof
$migration=Get-Content -Raw supabase/migrations/20270128000281_fnb_create_recovery_ordering_v1.sql
if([regex]::Matches($migration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($migration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected transaction boundary'}
$migration=[regex]::Replace($migration,'(?m)^COMMIT;\r?\n?','')
$fixture=Get-Content -Raw tests/cashier/fnb733.link-targets.case.sql
$marker=' -- Missing entry remains an explicit unavailable count, never a silently valid person link.'
if([regex]::Matches($fixture,[regex]::Escape($marker)).Count-ne 1){throw 'FNB733 fixture seam drift'}
$case=Get-Content -Raw tests/cashier/fnb734.create-replay.case.sql
if($Cancel737){
 $cancelMarker=" RAISE NOTICE 'FNB734_COMMITTED_REPLAY_AFTER_DEPARTURE_PAYLOAD_ACTOR_CONFLICT_NEW_REF_DENIED_ONE_PENDING_NO_PAYMENT_PASS';"
 if([regex]::Matches($case,[regex]::Escape($cancelMarker)).Count-ne 1){throw 'FNB734 cancel seam drift'}
 $case=$case.Replace($cancelMarker,(Get-Content -Raw tests/cashier/fnb737.cancel.case.sql)+"`n"+$cancelMarker)
}
if($Receipt735){
 $receiptMarker=" RAISE NOTICE 'FNB734_COMMITTED_REPLAY_AFTER_DEPARTURE_PAYLOAD_ACTOR_CONFLICT_NEW_REF_DENIED_ONE_PENDING_NO_PAYMENT_PASS';"
 if([regex]::Matches($case,[regex]::Escape($receiptMarker)).Count-ne 1){throw 'FNB734 receipt seam drift'}
 $case=$case.Replace($receiptMarker,(Get-Content -Raw tests/cashier/fnb735.receipt.case.sql)+"`n"+$receiptMarker)
}
$prefix=$migration
if($Installed){$prefix=@'
BEGIN;
DO $$ BEGIN ASSERT md5(pg_get_functiondef('public.fnb_create_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,uuid,uuid)'::regprocedure))='4b03c3050f53ebc040b4c3330f998564','installed writer drift'; END $$;
'@}
if($Receipt735 -and -not $ReceiptInstalled735){
 $readMigration=Get-Content -Raw supabase/migrations/20270128000282_fnb_create_receipt_read_v1.sql
 if([regex]::Matches($readMigration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($readMigration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected receipt migration boundary'}
 $prefix+="`n"+[regex]::Replace($readMigration,'(?m)^(BEGIN|COMMIT);\r?\n?','')
}
if($ReceiptInstalled735){
 $readerDigest=if($CancelInstalled737){'07e31abf9812e328d7b47d78d7cdb2a8'}else{'04bac24e458317e0c9835af1114ee115'}
 $prefix+="`nDO `$`$ BEGIN ASSERT md5(pg_get_functiondef('public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure))='$readerDigest','installed receipt reader drift'; END `$`$;"
}
if($Cancel737 -and -not $CancelInstalled737){
 $cancelMigration=Get-Content -Raw supabase/migrations/20270128000283_fnb_create_cancel_fence_v1.sql
 if([regex]::Matches($cancelMigration,'(?m)^BEGIN;\r?$').Count-ne 1-or[regex]::Matches($cancelMigration,'(?m)^COMMIT;\r?$').Count-ne 1){throw 'Unexpected cancel migration boundary'}
 $prefix+="`n"+[regex]::Replace($cancelMigration,'(?m)^(BEGIN|COMMIT);\r?\n?','')
}
if($CancelInstalled737){$prefix+=@'

DO $$ BEGIN
 ASSERT md5(pg_get_functiondef('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure))='2f4a64f991f4f2b2caf0b10002cdf93c';
 ASSERT md5(pg_get_functiondef('public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)'::regprocedure))='0f9dc8e006caf29ff71ef3149f7b30e1';
END $$;
'@}
$digests=''
if($Cancel737){$digests=@'
SELECT jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN('_fnb_bind_create_intent_v1','fnb_get_create_receipt_v1','fnb_cancel_create_intent_v1');
'@}
$sql=$prefix+"`n"+$fixture.Replace($marker,$case+"`n"+$marker)+"`n"+$digests+"`nROLLBACK;"
try{Invoke-Fnb734Sql $sql}finally{
 if((Invoke-Fnb734Sql $proof)-ne $before){throw 'FNB734 original authority/business/identity facts changed'}
}
Write-Host 'FNB734_EXACT281_CREATE_RECOVERY_AND_CANONICAL_READ_ROLLBACK_PASS'
if($Receipt735){Write-Host 'FNB735_EXACT282_READ_RECEIPT_ROLLBACK_PASS'}
