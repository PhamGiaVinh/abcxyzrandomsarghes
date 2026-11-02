Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$taskBase617=Join-Path $PSScriptRoot '..\..'
$taskMigration617=Get-Content -LiteralPath (Join-Path $taskBase617 'supabase\migrations\20270128000267_bag_reconciliation_actor_authority_v1.sql') -Raw
$taskRepro617=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bag617.authorization.rollback.sql') -Raw).Replace("`r`n","`n")
$taskRepro617=$taskRepro617 -replace '(?m)^BEGIN;\s*$','' -replace '(?m)^ROLLBACK;\s*$',''
$taskPre617=@'
\set ON_ERROR_STOP on
CREATE TEMP TABLE bag617_before AS SELECT
 pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure) definition,
 (SELECT proacl::text FROM pg_proc WHERE oid='public.chip_ops_day_reconcile(uuid,integer)'::regprocedure) acl,
 (SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text)) facts;
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
END $$;
'@
$taskPost617=@'
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 ASSERT (SELECT count(*)=2 AND sum(expected)=60000 FROM public.chip_ops_day_reconcile('46cab483-91e7-4220-aacf-e17bdf05269c',1));
 r:=public.get_bag_tag_state('46cab483-91e7-4220-aacf-e17bdf05269c',1);
 ASSERT jsonb_array_length(r->'players')=2 AND (r->'reconciliation'->>'total_expected_value')::bigint=60000;
END $$;
SET LOCAL request.jwt.claim.sub='';
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.chip_ops_day_reconcile('46cab483-91e7-4220-aacf-e17bdf05269c',1);
  RAISE EXCEPTION 'BAG617_MISSING_ACTOR_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.chip_ops_day_reconcile('46cab483-91e7-4220-aacf-e17bdf05269c',1);
  RAISE EXCEPTION 'BAG617_ANON_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.chip_ops_day_reconcile(uuid,integer)'::regprocedure)=(SELECT acl FROM bag617_before);
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure)=(SELECT definition FROM bag617_before);
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.chip_ops_day_reconcile(uuid,integer)'::regprocedure)=(SELECT acl FROM bag617_before);
 ASSERT (SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text))=(SELECT facts FROM bag617_before);
END $$;
SELECT 'BAG617_CANDIDATE_OWNER_OUTSIDER_MISSING_ACTOR_ANON_EXACT_FUNCTION_ACL_DATA_ROLLBACK_PASS';
'@
($taskPre617+"`n"+$taskMigration617+"`n"+$taskRepro617+"`n"+$taskPost617) | wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw '617 candidate runtime failed; connection closure rolls back candidate'}
