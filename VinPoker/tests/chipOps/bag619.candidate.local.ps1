$ErrorActionPreference='Stop'
$taskBody619=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../supabase/migrations/20270128000268_bag_table_label_canonical_v1.sql') -Raw
$taskLabels619=[regex]::Replace((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag619.labels.rollback.sql') -Raw),'(?m)^(BEGIN READ ONLY|ROLLBACK);\r?$','')
$taskAuth619=[regex]::Replace((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag617.authorization.rollback.sql') -Raw),'(?m)^(BEGIN|ROLLBACK);\r?$','')
$taskPre619=@'
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT md5(replace(pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure),chr(13),''))='a5aa884f5e3c4e7e5befeeb9efeb91c3';
 ASSERT to_regprocedure('floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)') IS NULL;
END $$;
CREATE TEMP TABLE bag619_before AS SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl
 FROM pg_proc WHERE oid IN('public.get_bag_tag_state(uuid,integer)'::regprocedure,'public.chip_ops_day_reconcile(uuid,integer)'::regprocedure);
CREATE FUNCTION pg_temp.bag619_without_labels(j jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_set(jsonb_set(j,'{players}',(SELECT coalesce(jsonb_agg(x-'table_name' ORDER BY x->>'player_id'),'[]') FROM jsonb_array_elements(j->'players') x)),
 '{reconciliation,players}',(SELECT coalesce(jsonb_agg(x-'table_name' ORDER BY x->>'player_id'),'[]') FROM jsonb_array_elements(j->'reconciliation'->'players') x));
$$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
CREATE TEMP TABLE bag619_snapshot AS SELECT pg_temp.bag619_without_labels(public.get_bag_tag_state('46cab483-91e7-4220-aacf-e17bdf05269c',1)) v;
'@
$taskPost619=@'
DO $$ DECLARE tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';tt uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';
 physical uuid:='c474ac95-6896-445d-81ba-dd6d752528df';sess uuid:='ee2b9393-0c96-42f9-8667-7f306edeb9bc';BEGIN
 ASSERT floor_private.chip_bag_table_label_v1(tour,tt,tt,sess)='Paid journey TEST 2';
 ASSERT floor_private.chip_bag_table_label_v1(tour,NULL,tt,NULL)='Paid journey TEST 2';
 ASSERT floor_private.chip_bag_table_label_v1(tour,NULL,physical,NULL)='Paid journey TEST 2';
 ASSERT floor_private.chip_bag_table_label_v1(tour,tt,physical,sess)='Paid journey TEST 2';
 ASSERT floor_private.chip_bag_table_label_v1(tour,tt,gen_random_uuid(),sess) IS NULL;
 ASSERT floor_private.chip_bag_table_label_v1(tour,gen_random_uuid(),physical,NULL) IS NULL;
 ASSERT floor_private.chip_bag_table_label_v1(tour,tt,tt,gen_random_uuid()) IS NULL;
 ASSERT floor_private.chip_bag_table_label_v1(tour,NULL,'991b1e8e-da4c-461a-9b39-ddebd7a5d044',NULL) IS NULL;
 ASSERT NOT has_function_privilege('anon','floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM bag619_before b JOIN pg_proc p ON p.oid=to_regprocedure(b.signature) WHERE p.proacl::text IS DISTINCT FROM b.acl);
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
DO $$ BEGIN
 ASSERT pg_temp.bag619_without_labels(public.get_bag_tag_state('46cab483-91e7-4220-aacf-e17bdf05269c',1))=(SELECT v FROM bag619_snapshot);
END $$;
ROLLBACK;
SELECT to_regprocedure('floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid)') IS NULL AS helper_rollback;
SELECT 'BAG619_CANONICAL_LEGACY_CONFLICT_SESSION_TENANT_ACL_NONLABEL_FIELDS_ROLLBACK_PASS';
'@
($taskPre619+"`n"+$taskBody619+"`n"+$taskLabels619+"`n"+$taskAuth619+"`n"+$taskPost619) |
 wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw '619 candidate failed; transaction closes rolled back'}
