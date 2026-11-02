-- LOCAL only; wrap in BEGIN/ROLLBACK for a recovery rehearsal.
DO $$ DECLARE b record;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
   AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441,'LOCAL604_RECOVERY_ONLY';
 ASSERT (SELECT count(*) FROM floor_private.tracker_source_trigger_acl_backup266)=3;
 FOR b IN SELECT * FROM floor_private.tracker_source_trigger_acl_backup266 ORDER BY table_name LOOP
  ASSERT b.table_name IN('tournament_hands','hand_actions','hand_players','public.tournament_hands','public.hand_actions','public.hand_players');
  ASSERT (SELECT relacl::text FROM pg_class WHERE oid=to_regclass(b.table_name))=b.after_acl,'source604_recovery_acl_drift';
  ASSERT b.before_acl='{postgres=arwdDxtm/postgres,anon=arwdxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}';
  EXECUTE format('GRANT TRIGGER ON TABLE %s TO anon,authenticated',to_regclass(b.table_name));
  ASSERT (SELECT relacl::text FROM pg_class WHERE oid=to_regclass(b.table_name))=b.before_acl,'source604_recovery_not_exact';
 END LOOP;
 RAISE NOTICE 'SOURCE604_EXACT_THREE_TABLE_ACL_RECOVERY_PASS';
END $$;
