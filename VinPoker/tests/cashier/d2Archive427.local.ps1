param([switch]$Apply)
$ErrorActionPreference='Stop'
$taskMigration=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000242_d2_initial_draw_archive_read_v1.sql'
$taskBody=[regex]::Replace((Get-Content $taskMigration -Raw),'(?m)^(BEGIN|COMMIT);\r?$','')
$taskPre=@'
BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000242');
END $$;
SELECT set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
CREATE TEMP TABLE before427 ON COMMIT DROP AS SELECT public.multi_day_final_roster_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d') AS value;
CREATE TEMP TABLE archive427 ON COMMIT DROP AS SELECT jsonb_agg(to_jsonb(a) ORDER BY a.plan_id) AS value FROM private.multi_day_initial_draw_applications_v1 a;
'@
$taskPost=@'
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.multi_day_final_roster_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 ASSERT jsonb_array_length(r->'initialDraws')=1;
 ASSERT jsonb_array_length(r#>'{initialDraws,0,assignments}')=15;
 ASSERT (SELECT sum((x->>'stack')::bigint) FROM jsonb_array_elements(r#>'{initialDraws,0,assignments}') x)=300000;
 ASSERT (SELECT array_agg(DISTINCT (x->>'tableNumber')::int ORDER BY (x->>'tableNumber')::int) FROM jsonb_array_elements(r#>'{initialDraws,0,assignments}') x)=ARRAY[7,8,9];
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{initialDraws,0,assignments}') x WHERE x ? 'requestId');
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
DO $$ BEGIN
 BEGIN PERFORM public.multi_day_final_roster_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d');RAISE EXCEPTION 'outsider unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
DO $$ BEGIN
 ASSERT public.multi_day_final_roster_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d')-'initialDraws'=(SELECT value FROM before427);
 ASSERT (SELECT value FROM archive427) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.plan_id) FROM private.multi_day_initial_draw_applications_v1 a);
 ASSERT NOT has_function_privilege('anon','public.multi_day_final_roster_v1(uuid)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','floor_private.d2_roster_backup242','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.d2_roster_backup242','SELECT');
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.d2_roster_backup242'::regclass);
END $$;
'@
$taskEnd=if($Apply){'COMMIT;'}else{'ROLLBACK;'}
($taskPre+"`n"+$taskBody+"`n"+$taskPost+"`n"+$taskEnd) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'D2 archive427 failed/rolled back'}
Write-Output "D2_ARCHIVE427_LOCAL_PASS_APPLY=$Apply"
