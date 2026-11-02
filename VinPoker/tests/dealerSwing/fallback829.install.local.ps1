$ErrorActionPreference='Stop'
if($env:VINPOKER_FALLBACK829_INSTALL -ne '1'){throw 'Explicit LOCAL829 installation mode required'}
$taskSource=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000292_dealer_swing_fallback_pool_scope_v1.sql'
$taskHash=(Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant()
if($taskHash -ne 'e88c694345bfd208c892af9c6364694abb9b024977df4913f568a429f3170630'){throw '292 source drift'}
$taskCandidate=Get-Content -LiteralPath $taskSource -Raw
if(($taskCandidate -split "`nBEGIN;").Count -ne 2 -or $taskCandidate -notmatch 'COMMIT;\s*$'){throw 'Unexpected transaction shape'}
$taskCandidate=$taskCandidate.Replace("`nBEGIN;","`n") -replace 'COMMIT;\s*$',''
$taskSql=@'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 ASSERT to_regclass('private.fallback829_install') IS NULL,'829 consumed; use postcheck, never reinstall/reset';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND auto_swing_enabled);
END $$;
CREATE FUNCTION pg_temp.fallback829_facts() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.dealers x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.dealer_attendance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.dealer_breaks x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.audit_logs x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.dealer_payroll x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.payroll_periods x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.game_tables x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.tournament_tables x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.club_settings x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.centerpoint_tournament_ops_release x)
 )::text);
$$;
CREATE TEMP TABLE fallback829_old AS SELECT pg_get_functiondef(oid) definition,proowner owner_id,proacl acl,proconfig settings,
 pg_temp.fallback829_facts() business_fingerprint FROM pg_proc
 WHERE oid='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
__CANDIDATE__
CREATE TABLE private.fallback829_install(id boolean PRIMARY KEY DEFAULT true CHECK(id),source_sha256 text NOT NULL,old_catalog jsonb NOT NULL,installed_digest text NOT NULL,business_fingerprint text NOT NULL);
ALTER TABLE private.fallback829_install ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.fallback829_install FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.fallback829_install(source_sha256,old_catalog,installed_digest,business_fingerprint)
 SELECT 'e88c694345bfd208c892af9c6364694abb9b024977df4913f568a429f3170630',
 jsonb_build_object('definition',b.definition,'owner_id',b.owner_id,'acl',b.acl,'settings',b.settings),
 md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure)),b.business_fingerprint FROM fallback829_old b;
DO $$ BEGIN
 ASSERT (SELECT pg_temp.fallback829_facts()=business_fingerprint FROM fallback829_old);
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000292');
END $$;
COMMIT;
SELECT 'FALLBACK829_OWNED_CLONE_ONLY_INSTALL_BUSINESS_UNCHANGED_BACKUP_RETAINED_LEDGER_ZERO_PASS';
'@
$taskSql=$taskSql.Replace('__CANDIDATE__',$taskCandidate)
$taskSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_checkout814_race_local psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw '829 LOCAL install failed; inspect transaction/catalog before retry'}
