BEGIN READ ONLY;
DO $test$ DECLARE fn record;role_name text;arguments text;tested integer:=0;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 FOR fn IN SELECT oid,proname,pronargs FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  '_tracker_voice_assignment_context','_tracker_voice_register_validated_event','_tracker_voice_register_validated_board_event',
  'commit_tracker_voice_finish_v0','commit_tracker_voice_hole_cards_v0') LOOP
  arguments:=array_to_string(array_fill('NULL'::text,ARRAY[fn.pronargs]),',');
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   ASSERT NOT has_function_privilege(role_name,fn.oid,'EXECUTE');
   PERFORM set_config('role',role_name,true);
   BEGIN
    EXECUTE format('SELECT public.%I(%s)',fn.proname,arguments);
    RAISE EXCEPTION 'client unexpectedly invoked internal Voice function';
   EXCEPTION WHEN insufficient_privilege THEN NULL;
   END;
   PERFORM set_config('role','none',true);
   tested:=tested+1;
  END LOOP;
 END LOOP;
 ASSERT tested=10;
 ASSERT has_function_privilege('authenticated','public.commit_tracker_voice_board_v0(uuid,text,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.commit_tracker_voice_board_v0(uuid,text,text)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.get_tracker_voice_validation_snapshot(uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.get_tracker_voice_validation_snapshot(uuid,uuid,uuid)','EXECUTE');
 RAISE NOTICE 'VOICE456_TEN_REAL_ANON_AUTH_INTERNAL_EXECUTE_DENIALS_AND_PUBLIC_ENTRY_ACL_PASS';
END $test$;
ROLLBACK;
