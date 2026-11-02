-- LOCAL rehearsal only: restore predecessor inside SAVEPOINT, then ROLLBACK TO it.
-- The predecessor is known vulnerable. Never commit this recovery as a fix.
DO $recover$
DECLARE b record;metadata jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
  AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT * INTO STRICT b FROM floor_private.tracker_hand_policy_backup295 WHERE id;
 ASSERT b.before_digest='e429b3f6a9164828faf23013d75dba00';
 ASSERT md5(b.before_metadata::text)=b.before_digest;
 SELECT jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
  'roles',polroles,'permissive',polpermissive,'command',polcmd) INTO STRICT metadata
 FROM pg_policy WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins';
 ASSERT md5(metadata::text)=b.after_digest,'source853 recovery current policy drift';
 EXECUTE 'DROP POLICY "Tournament hands manageable by admins" ON public.tournament_hands';
 EXECUTE b.before_definition;
 SELECT jsonb_build_object('qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
  'roles',polroles,'permissive',polpermissive,'command',polcmd) INTO STRICT metadata
 FROM pg_policy WHERE polrelid='public.tournament_hands'::regclass AND polname='Tournament hands manageable by admins';
 ASSERT metadata=b.before_metadata,'source853 predecessor metadata not exact';
 RAISE NOTICE 'SOURCE853_EXACT_PREDECESSOR_POLICY_METADATA_RECOVERY_REHEARSAL_PASS';
END $recover$;
