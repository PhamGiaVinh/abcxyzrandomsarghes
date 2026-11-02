\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441,'LOCAL387_ONLY';
END $$;
CREATE TEMP TABLE source387_before AS
 SELECT (SELECT count(*) FROM public.hand_actions) actions,
 (SELECT count(*) FROM public.tournament_settlement_outcomes WHERE status='verified') verified,
 (SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY id)::text) FROM public.tournament_hands h) hands;
DO $$
DECLARE actor_role text; source_table text; denied boolean; before_count bigint; after_count bigint;
BEGIN
 SELECT actions INTO before_count FROM source387_before;
 ASSERT before_count>0,'retained source required';
 FOREACH actor_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH source_table IN ARRAY ARRAY['hand_actions','hand_players'] LOOP
   denied:=false;
   BEGIN
    EXECUTE format('SET LOCAL ROLE %I',actor_role);
    EXECUTE format('TRUNCATE TABLE public.%I',source_table);
   EXCEPTION WHEN insufficient_privilege THEN denied:=true;
   END;
   RESET ROLE;
   IF NOT denied THEN
    SELECT count(*) INTO after_count FROM public.hand_actions;
    RAISE NOTICE 'SOURCE387_TRUNCATE_ALLOWED role=% table=% actions_before=% actions_after=% verified_proofs=%',
     actor_role,source_table,before_count,after_count,(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE status='verified');
   END IF;
   ASSERT denied,format('source387_unfenced_truncate:%s:%s',actor_role,source_table);
  END LOOP;
  ASSERT NOT has_table_privilege(actor_role,'public.tournament_hands','TRUNCATE'),'source387_parent_truncate_grant';
 END LOOP;
 ASSERT (SELECT count(*) FROM public.hand_actions)=(SELECT actions FROM source387_before);
 ASSERT (SELECT count(*) FROM public.tournament_settlement_outcomes WHERE status='verified')=(SELECT verified FROM source387_before);
 ASSERT (SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY id)::text) FROM public.tournament_hands h)=(SELECT hands FROM source387_before);
 RAISE NOTICE 'SOURCE387_BOTH_CLIENT_ROLES_TRUNCATE_DENIED_HANDS_PROOFS_UNCHANGED_PASS';
END $$;
ROLLBACK;
