param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Use -Apply only for the exact qualified LOCAL database; no production target supported.'}
$taskMigrationPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000234_tournament_create_money_integrity_v1.sql'
if((Get-FileHash -LiteralPath $taskMigrationPath -Algorithm SHA256).Hash -ne '0DC866D4D66B1925BAAA0D48295AF5BE777CD6591239012F4F945DBB303FC6BC'){
 throw 'create374 source changed; requalify before installing'
}
$taskBody=[regex]::Replace((Get-Content -LiteralPath $taskMigrationPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskFingerprint=@'
SELECT md5(jsonb_build_object(
 'tournaments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 'levels',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_levels t),
 'entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_entries t),
 'seats',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_seats t),
 'cash',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cashier_buyin_movements t),
 'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_prize_payments t),
 'attendance',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.dealer_attendance t))::text)
'@
$taskPre=@'
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
 OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'create374_local_install_only'; END IF;
END $$;
'@
$taskPost=@'
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure)
  IS DISTINCT FROM 'e0138e0be86fc4cfdaf325a216a415b7'
 OR has_table_privilege('authenticated','floor_private.tournament_create_release_backup234','SELECT')
 OR has_table_privilege('service_role','floor_private.tournament_create_release_backup234','SELECT')
 THEN RAISE EXCEPTION 'create374_install_postcondition_failed'; END IF;
END $$;
'@
$taskSql=$taskPre+"`nSELECT set_config('vinpoker.create374_before',($taskFingerprint),true);`n"+$taskBody+"`n"+$taskPost+"`nDO `$`$ BEGIN IF current_setting('vinpoker.create374_before') IS DISTINCT FROM ($taskFingerprint) THEN RAISE EXCEPTION 'create374_business_data_changed'; END IF; END `$`$;`nCOMMIT;"
$taskSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'create374 local install failed; transaction rolled back'}
Write-Output 'CREATE374_LOCAL_INSTALLED_BUSINESS_DATA_UNCHANGED_NO_LEDGER_WRITE'
