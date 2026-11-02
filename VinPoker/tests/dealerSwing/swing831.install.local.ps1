$ErrorActionPreference='Stop'
if($env:VINPOKER_SWING831_INSTALL -ne '1'){throw 'Explicit LOCAL831 installation mode required'}
$taskSource=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000293_dealer_swing_error_atomic_v1.sql'
$taskHash=(Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant()
if($taskHash -ne 'c8ec6d9808866598809550e6164490677b425147635cee243d6230fa906620ce'){throw '293 source drift'}
$taskCandidate=(Get-Content -LiteralPath $taskSource -Raw).Replace("`r`n","`n")
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
 ASSERT to_regclass('private.swing831_install') IS NULL,'831 consumed; never reinstall/reset';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND auto_swing_enabled);
END $$;
CREATE FUNCTION pg_temp.swing831_facts() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE names text[]:=ARRAY['dealers','dealer_attendance','dealer_assignments','dealer_breaks','audit_logs','dealer_payroll','payroll_periods','cashier_buyin_movements','tournaments','game_tables','table_sessions','tournament_tables','club_settings','centerpoint_tournament_ops_release','dealer_swing_operator_requests'];
 name text; digest text; result jsonb:='{}';
BEGIN
 FOREACH name IN ARRAY names LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,''null'')) FROM public.%I x',name) INTO digest;
  result:=result||jsonb_build_object(name,digest);
 END LOOP;
 RETURN result;
END $$;
CREATE TEMP TABLE swing831_old AS SELECT pg_get_functiondef(oid) definition,proowner owner_id,proacl acl,proconfig settings,
 pg_temp.swing831_facts() facts FROM pg_proc WHERE oid='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
__CANDIDATE__
CREATE TABLE private.swing831_install(id boolean PRIMARY KEY DEFAULT true CHECK(id),source_sha256 text NOT NULL,old_catalog jsonb NOT NULL,installed_digest text NOT NULL,facts jsonb NOT NULL);
ALTER TABLE private.swing831_install ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.swing831_install FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.swing831_install(source_sha256,old_catalog,installed_digest,facts)
 SELECT 'c8ec6d9808866598809550e6164490677b425147635cee243d6230fa906620ce',
 jsonb_build_object('definition',b.definition,'owner_id',b.owner_id,'acl',b.acl,'settings',b.settings),
 md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure)),b.facts FROM swing831_old b;
DO $$ BEGIN
 ASSERT (SELECT pg_temp.swing831_facts()=facts FROM swing831_old);
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000293');
END $$;
COMMIT;
SELECT 'SWING831_OWNED_ONLY_INSTALL_15_FACT_GROUPS_UNCHANGED_BACKUP_RETAINED_LEDGER_ZERO_PASS';
'@
$taskSql=$taskSql.Replace('__CANDIDATE__',$taskCandidate)
$taskSql | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_checkout814_race_local psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw '831 local install failed; inspect transaction/catalog before retry'}
