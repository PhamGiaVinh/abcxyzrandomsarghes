-- LOCAL REHEARSAL ONLY. Production containment needs exact release approval.
-- Preserve the integrity trigger and history; do not rewind actions or chips.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
DO $test$
DECLARE
 target regprocedure:='public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure;
 before_acl text; before_definition text; before_trigger text; before_rows text;
BEGIN
 ASSERT current_user='postgres';
 ASSERT current_database()='vinpoker_decided_action_20261028';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_DECIDED_ACTION_20261028_OWNED_LOCAL_TEST';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 SELECT proacl::text,md5(replace(prosrc,chr(13),'')) INTO before_acl,before_definition FROM pg_proc WHERE oid=target;
 ASSERT before_acl='{postgres=X/postgres,authenticated=X/postgres}';
 ASSERT before_definition='ccf4f55e6826bef6d4fe35dd7b38c30f';
 SELECT md5(pg_get_triggerdef(oid)) INTO STRICT before_trigger FROM pg_trigger
 WHERE tgrelid='public.hand_actions'::regclass AND tgname='trg_guard_tracker_action_stack189' AND tgenabled='O';
 ASSERT before_trigger IS NOT NULL;
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text) INTO before_rows;

 REVOKE EXECUTE ON FUNCTION public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid) FROM authenticated;
 ASSERT NOT has_function_privilege('authenticated',target,'EXECUTE');
 ASSERT NOT has_function_privilege('anon',target,'EXECUTE');
 ASSERT NOT has_function_privilege('service_role',target,'EXECUTE');
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.record_action(NULL::uuid,NULL::uuid,'check',1,1,'preflop',0,NULL::text,NULL::text,NULL::uuid);
  RAISE EXCEPTION 'contained_writer_was_callable';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT md5(pg_get_triggerdef(oid))=before_trigger AND tgenabled='O' FROM pg_trigger
  WHERE tgrelid='public.hand_actions'::regclass AND tgname='trg_guard_tracker_action_stack189');

 GRANT EXECUTE ON FUNCTION public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid) TO authenticated;
 ASSERT (SELECT proacl::text=before_acl AND md5(replace(prosrc,chr(13),''))=before_definition FROM pg_proc WHERE oid=target);
 ASSERT has_function_privilege('authenticated',target,'EXECUTE');
 ASSERT NOT has_function_privilege('anon',target,'EXECUTE');
 ASSERT NOT has_function_privilege('service_role',target,'EXECUTE');
 ASSERT (SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text)=before_rows);
END;
$test$;
ROLLBACK;
SELECT 'LOCAL_CONTAINMENT_DENIES_WRITER_PRESERVES_TRIGGER_RESTORES_EXACT_ACL_PASS';
