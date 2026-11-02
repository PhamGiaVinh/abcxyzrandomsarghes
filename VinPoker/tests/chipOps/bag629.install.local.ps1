$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../../supabase/migrations/20270128000270_bag_tag_durable_intent_v1.sql'
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne 'BDA250AA4B1A6CC3F47E7F76640653F632C3AF5F6391475698BBE147D40EE1DF') { throw 'source270 drift' }
$candidate = (Get-Content -LiteralPath $sourcePath -Raw) -replace '(?m)^BEGIN;\r?$', '' -replace '(?m)^COMMIT;\r?$', ''
$prefix = @'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regprocedure('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)') IS NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000270');
END $$;
CREATE TEMP TABLE bag629_before ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x))::text) facts;
'@
$post = @'
DO $$ BEGIN
 ASSERT md5(replace(pg_get_functiondef('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)'::regprocedure),chr(13),''))='22bf8a1b1ee90c116d6ad2908e85cf09';
 ASSERT NOT has_function_privilege('anon','public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)','EXECUTE');
END $$;
SAVEPOINT recovery_rehearsal;
DROP FUNCTION public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text);
DO $$ BEGIN ASSERT to_regprocedure('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)') IS NULL;END $$;
ROLLBACK TO SAVEPOINT recovery_rehearsal;
DO $$ BEGIN
 ASSERT md5(replace(pg_get_functiondef('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)'::regprocedure),chr(13),''))='22bf8a1b1ee90c116d6ad2908e85cf09';
 ASSERT (SELECT facts FROM bag629_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x))::text);
END $$;
COMMIT;
SELECT 'BAG629_LOCAL270_INSTALL_RECOVERY_REHEARSAL_NO_BUSINESS_DELTA_PASS';
'@
($prefix + "`n" + $candidate + "`n" + $post) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'local270 installation failed; no retry without catalog inspection' }
