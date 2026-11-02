param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Explicit isolated local -Apply required'}
Set-Location (Join-Path $PSScriptRoot '../..')
function Inner-Fnb731Sql([string]$path){
 $body=Get-Content -LiteralPath $path -Raw
 if([regex]::Matches($body,'(?m)^BEGIN;\r?$').Count-ne1 -or [regex]::Matches($body,'(?m)^COMMIT;\r?$').Count-ne1){throw 'Unexpected SQL boundary'}
 return [regex]::Replace([regex]::Replace($body,'(?m)^BEGIN;\r?\n',''),'(?m)^COMMIT;\r?\n?','')
}
$prefix=@'
BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT current_setting('server_version_num')::int BETWEEN 170000 AND 179999;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT to_regclass('floor_private.fnb_shift_release_backup731') IS NULL;
 ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL;
 ASSERT public.is_club_owner('a364de8e-06b1-4428-a20d-ac614ec406e5','349ecf35-50ba-4c71-a581-15dc45f1cd01');
END $$;
CREATE TABLE floor_private.fnb_shift_release_backup731 AS
 SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proowner,p.proacl,p.proconfig,p.prosecdef,clock_timestamp() captured_at
 FROM pg_proc p WHERE p.oid IN('public.fnb_mark_paid(uuid,text)'::regprocedure,'public.fnb_cancel_order(uuid,text)'::regprocedure,
 'public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure,'public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure,
 'public.settle_bank_transaction(uuid,boolean)'::regprocedure);
ALTER TABLE floor_private.fnb_shift_release_backup731 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_shift_release_backup731 FROM PUBLIC,anon,authenticated,service_role;
CREATE TEMP VIEW fnb731_business_fingerprint AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_orders x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_order_items x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_order_events x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_stock_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.fnb_ingredients x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.bank_transactions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.payment_settlements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_prize_payments x)
)::text) fingerprint;
CREATE TEMP TABLE fnb731_before AS SELECT * FROM fnb731_business_fingerprint;
'@
$post=@'
DO $$ BEGIN
 ASSERT NOT has_function_privilege('authenticated','public.fnb_open_shift_v2(uuid,bigint,text,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.settle_bank_transaction(uuid,boolean)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.fnb_get_shift_report(uuid)','EXECUTE');
END $$;
ROLLBACK TO recovery731;
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM fnb731_before)=(SELECT fingerprint FROM fnb731_business_fingerprint);
 ASSERT (SELECT count(*)=5 FROM floor_private.fnb_shift_release_backup731);
 ASSERT NOT has_table_privilege('authenticated','floor_private.fnb_shift_release_backup731','SELECT');
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_cashier_shifts);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.fnb_shift_order_events_v1);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.fnb_shift_intents_v1);
 ASSERT has_function_privilege('authenticated','public.fnb_open_shift_v2(uuid,bigint,text,uuid)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.settle_bank_transaction(uuid,boolean)','EXECUTE');
 ASSERT md5(pg_get_functiondef('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure))='5e92d765ed352629a05eb98092d0b64d';
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN('20270128000278','20270128000279'));
END $$;
SELECT 'FNB731_LOCAL_EXACT278_279_INSTALLED_PRIVATE_BACKUP_SUSPENSION_REHEARSED_TWELVE_TABLE_FACTS_UNCHANGED_NO_BACKFILL_OR_LEDGER';
COMMIT;
'@
$sql="\set ON_ERROR_STOP on`n"+$prefix+"`n"+(Inner-Fnb731Sql 'supabase/migrations/20270128000278_fnb_order_event_integrity_v1.sql')+"`n"+
 (Inner-Fnb731Sql 'supabase/migrations/20270128000279_fnb_cash_shift_integrity_v1.sql')+"`nSAVEPOINT recovery731;`n"+
 (Inner-Fnb731Sql 'docs/emergency_rollbacks/20270128000279_fnb_suspend_cash_shift_writes.sql')+"`n"+$post
$sql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE-ne0){throw 'FNB731 local install failed, disconnected transaction rolls back; inspect before retry'}
