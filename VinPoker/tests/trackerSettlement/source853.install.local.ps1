param([switch]$Apply)
$ErrorActionPreference='Stop'
if (-not $Apply) {throw 'Exact PRIMARY LOCAL policy only; -Apply required'}
$taskPath=Join-Path $PSScriptRoot '../../supabase/migrations/20270128000295_tracker_hand_tenant_write_guard_v1.sql'
if ((Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash -ne '8202E08A3719ED087A403A6B5A50EDA27727351A6E99ACF9CB6D4033AECBF1D2') {throw 'source853 migration source drift'}
$taskMigration=Get-Content -LiteralPath $taskPath -Raw
if ([regex]::Matches($taskMigration,'(?m)^BEGIN;\r?$').Count -ne 1 -or [regex]::Matches($taskMigration,'(?m)^COMMIT;\r?$').Count -ne 1) {throw 'source853 migration boundary drift'}
$taskMigration=[regex]::Replace($taskMigration,'(?m)^(BEGIN|COMMIT);\r?$','')
$taskRecovery=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source853.recover.local.sql') -Raw
$taskPre=@'
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
  AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT current_setting('server_version_num')::int BETWEEN 170000 AND 179999;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','dblink'));
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000295');
 ASSERT to_regclass('floor_private.tracker_hand_policy_backup295') IS NULL,'source853 already installed; do not replay';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
  AND state IN('active','idle in transaction')),'source853 other native writer/transaction active';
END $$;
CREATE TABLE floor_private.tracker_hand_policy_backup295(
 id boolean PRIMARY KEY CHECK(id),before_definition text NOT NULL,before_metadata jsonb NOT NULL,
 before_digest text NOT NULL,after_digest text,source_sha256 text NOT NULL,business_digest text NOT NULL);
ALTER TABLE floor_private.tracker_hand_policy_backup295 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tracker_hand_policy_backup295 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION pg_temp.source853_facts() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.user_roles x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_cashiers x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_trackers x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,user_id) FROM public.club_dealer_controls x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x)
 )::text);
$$;
CREATE TEMP TABLE source853_before AS SELECT pg_temp.source853_facts() business,
 (SELECT md5(jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity)::text)
  FROM pg_class WHERE oid='public.tournament_hands'::regclass) table_metadata,
 (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY oid)::text) FROM pg_policy p
  WHERE polrelid='public.tournament_hands'::regclass AND polname<>'Tournament hands manageable by admins') other_policies,
 (SELECT md5(string_agg(pg_get_triggerdef(oid),'|' ORDER BY oid)) FROM pg_trigger
  WHERE tgrelid='public.tournament_hands'::regclass AND NOT tgisinternal) triggers;
INSERT INTO floor_private.tracker_hand_policy_backup295
 SELECT true,format('CREATE POLICY %I ON public.tournament_hands AS PERMISSIVE FOR ALL TO PUBLIC USING (%s)',
   polname,pg_get_expr(polqual,polrelid)),
  jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
   'roles',polroles,'permissive',polpermissive,'command',polcmd),
  md5(jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
   'roles',polroles,'permissive',polpermissive,'command',polcmd)::text),NULL,
  '8202e08a3719ed087a403a6b5a50eda27727351a6e99acf9cb6d4033aecbf1d2',pg_temp.source853_facts()
 FROM pg_policy WHERE polrelid='public.tournament_hands'::regclass
  AND polname='Tournament hands manageable by admins' AND polroles=ARRAY[0::oid]
  AND polpermissive AND polcmd='*' AND polwithcheck IS NULL;
DO $$ BEGIN ASSERT (SELECT count(*) FROM floor_private.tracker_hand_policy_backup295)=1;END $$;
'@
$taskAfterMigration=@'
UPDATE floor_private.tracker_hand_policy_backup295 SET after_digest=(
 SELECT md5(jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
  'roles',polroles,'permissive',polpermissive,'command',polcmd)::text) FROM pg_policy
 WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins');
SAVEPOINT source853_recovery;
'@
$taskPost=@'
DO $$ BEGIN
 ASSERT (SELECT after_digest FROM floor_private.tracker_hand_policy_backup295)=(
  SELECT md5(jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
   'roles',polroles,'permissive',polpermissive,'command',polcmd)::text) FROM pg_policy
  WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins');
 ASSERT (SELECT business FROM source853_before)=pg_temp.source853_facts();
 ASSERT (SELECT table_metadata FROM source853_before)=(SELECT md5(jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity)::text) FROM pg_class WHERE oid='public.tournament_hands'::regclass);
 ASSERT (SELECT other_policies FROM source853_before)=(SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY oid)::text) FROM pg_policy p WHERE polrelid='public.tournament_hands'::regclass AND polname<>'Tournament hands manageable by admins');
 ASSERT (SELECT triggers FROM source853_before)=(SELECT md5(string_agg(pg_get_triggerdef(oid),'|' ORDER BY oid)) FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND NOT tgisinternal);
 ASSERT NOT has_table_privilege('anon','floor_private.tracker_hand_policy_backup295','SELECT');
 ASSERT NOT has_table_privilege('authenticated','floor_private.tracker_hand_policy_backup295','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.tracker_hand_policy_backup295','SELECT');
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.tracker_hand_policy_backup295'::regclass);
 RAISE NOTICE 'SOURCE853_FOURTEEN_BUSINESS_GROUPS_TABLE_ACL_OTHER_POLICIES_TRIGGERS_UNCHANGED_PASS';
END $$;
SELECT after_digest FROM floor_private.tracker_hand_policy_backup295;
COMMIT;
'@
($taskPre+"`n"+$taskMigration+"`n"+$taskAfterMigration+"`n"+$taskRecovery+"`nROLLBACK TO source853_recovery;`n"+$taskPost) |
 wsl -d PokerVision-P16-4C-Eval -- env PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres PGDATABASE=vinpoker_ops_cash115_qualified_c psql -w -X -qAt -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {throw 'source853 local install failed; transaction rolled back'}
Write-Output 'SOURCE853_LOCAL_POLICY_INSTALLED_EXACT_BACKUP_RECOVERY_NO_LEDGER'
