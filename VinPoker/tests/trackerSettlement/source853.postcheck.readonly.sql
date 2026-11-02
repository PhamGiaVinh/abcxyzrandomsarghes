\set ON_ERROR_STOP on
-- Install-time global fingerprint. A later legitimate business COMMIT makes
-- that historical snapshot stale; never reset business data to force it green.
BEGIN READ ONLY;
SET LOCAL search_path=public;
DO $test$
DECLARE b record;fingerprint text;policy_digest text;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
  AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT * INTO STRICT b FROM floor_private.tracker_hand_policy_backup295 WHERE id;
 ASSERT b.source_sha256='8202e08a3719ed087a403a6b5a50eda27727351a6e99acf9cb6d4033aecbf1d2';
 ASSERT b.before_digest='e429b3f6a9164828faf23013d75dba00' AND md5(b.before_metadata::text)=b.before_digest;
 SELECT md5(jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
  'roles',polroles,'permissive',polpermissive,'command',polcmd)::text) INTO STRICT policy_digest
 FROM pg_policy WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins';
 ASSERT policy_digest=b.after_digest AND policy_digest='bf921781647754815e608c4841f6f7a0';
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
 )::text) INTO fingerprint;
 ASSERT fingerprint=b.business_digest,'source853 committed business data changed';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE hand_number IN(1852000001,1852000002,1852000003,1853000001,1853000002));
 ASSERT NOT public.has_role('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','super_admin');
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000295');
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='floor_private.tracker_hand_policy_backup295'::regclass);
 ASSERT NOT has_table_privilege('anon','floor_private.tracker_hand_policy_backup295','SELECT');
 ASSERT NOT has_table_privilege('authenticated','floor_private.tracker_hand_policy_backup295','SELECT');
 ASSERT NOT has_table_privilege('service_role','floor_private.tracker_hand_policy_backup295','SELECT');
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='idle in transaction');
 RAISE NOTICE 'SOURCE853_INSTALLED_POLICY_BACKUP_ACL_NO_LEDGER_NO_TEST_ROLES_OR_HANDS_FOURTEEN_BUSINESS_GROUPS_UNCHANGED_PASS';
END $test$;
ROLLBACK;
