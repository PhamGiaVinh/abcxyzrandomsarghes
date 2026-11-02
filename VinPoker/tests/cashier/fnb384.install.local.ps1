param([switch]$Apply)
$ErrorActionPreference='Stop'
if(-not $Apply){throw 'Exact isolated LOCAL target only; -Apply required.'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000235_fnb_shipping_transition_integrity_v1.sql'
if((Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash -ne '9602BD4CC8086E5DDDE1A271F9384AB9FDB91D409049C3C07A1B00B1119B6488'){throw 'fnb384 reviewed source drift'}
$taskBody=[regex]::Replace((Get-Content -LiteralPath $taskPath -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskTables=@('fnb_orders','fnb_order_items','fnb_order_events','fnb_ingredients','fnb_menu_items','fnb_recipe_items','fnb_stock_movements','cashier_buyin_movements','tournament_prize_payments','notifications')
$taskParts=$taskTables | ForEach-Object {'(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.'+$_+' t)'}
$taskFingerprint='SELECT md5(jsonb_build_array('+($taskParts -join ',')+')::text)'
$taskPre=@'
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'fnb384_local_install_only';END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000235') THEN RAISE EXCEPTION 'fnb384_ledger_collision';END IF;
END $$;
'@
$taskPost=@'
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure) IS DISTINCT FROM '31b85897c490845913ab864bdfd5320c'
 OR (SELECT count(*) FROM floor_private.fnb_shipping_release_backup235)<>1
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.fnb_shipping_release_backup235'::regclass)
 OR has_table_privilege('authenticated','floor_private.fnb_shipping_release_backup235','SELECT')
 OR has_table_privilege('anon','floor_private.fnb_shipping_release_backup235','SELECT')
 OR has_table_privilege('service_role','floor_private.fnb_shipping_release_backup235','SELECT')
 THEN RAISE EXCEPTION 'fnb384_install_postcondition_failed';END IF;
END $$;
'@
$taskSql=$taskPre+"`nSELECT set_config('vinpoker.fnb384_before',($taskFingerprint),true);`n"+$taskBody+"`n"+$taskPost+"`nDO `$`$ BEGIN IF current_setting('vinpoker.fnb384_before') IS DISTINCT FROM ($taskFingerprint) THEN RAISE EXCEPTION 'fnb384_business_data_changed';END IF;END `$`$;`nCOMMIT;"
$taskSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'fnb384 local install failed; transaction rolled back'}
Write-Output 'FNB384_LOCAL_INSTALLED_TEN_BUSINESS_TABLES_UNCHANGED_NO_LEDGER_WRITE'
