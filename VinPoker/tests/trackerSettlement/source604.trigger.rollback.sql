\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
   AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441,'LOCAL604_ONLY';
END $$;
CREATE TEMP TABLE source604_before AS
 SELECT (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_hands x) hands,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.hand_actions x) actions,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.hand_players x) players,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_settlement_outcomes x) outcomes,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision)::text) FROM public.tracker_historical_display_queue x) queue;
DO $test$
DECLARE actor_role text;source_table text;denied boolean;fn text;
BEGIN
 FOREACH actor_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  fn:='trigger_capability604_'||actor_role;
  EXECUTE format('SET LOCAL ROLE %I',actor_role);
  -- TEMP capability is real on this native catalog. No public-schema CREATE grant is required.
  EXECUTE format('CREATE FUNCTION pg_temp.%I() RETURNS trigger LANGUAGE plpgsql AS %L',fn,'BEGIN RETURN NEW; END');
  RESET ROLE;
  FOREACH source_table IN ARRAY ARRAY['tournament_hands','hand_actions','hand_players'] LOOP
   denied:=false;
   BEGIN
    EXECUTE format('SET LOCAL ROLE %I',actor_role);
    EXECUTE format('CREATE TRIGGER zzz_local_capability604 BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION pg_temp.%I()',source_table,fn);
   EXCEPTION WHEN insufficient_privilege THEN denied:=true;
   END;
   RESET ROLE;
   ASSERT denied,format('source604_client_trigger_creation_allowed:%s:%s',actor_role,source_table);
  END LOOP;
 END LOOP;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='zzz_local_capability604');
 ASSERT (SELECT hands FROM source604_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_hands x);
 ASSERT (SELECT actions FROM source604_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.hand_actions x);
 ASSERT (SELECT players FROM source604_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.hand_players x);
 ASSERT (SELECT outcomes FROM source604_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.tournament_settlement_outcomes x);
 ASSERT (SELECT queue FROM source604_before) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY hand_id,source_revision)::text) FROM public.tracker_historical_display_queue x);
 RAISE NOTICE 'SOURCE604_CLIENT_TRIGGER_DDL_DENIED_SIX_CASES_FIVE_SOURCE_FACTS_UNCHANGED_PASS';
END $test$;
ROLLBACK;
