-- Retained completed browser hand. No fake active state or poker outcome rewrite.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271'
  AND tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5' AND status='completed');
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION pg_temp.card_fingerprint() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(jsonb_build_array(
  (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271'),
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271'),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271'),
  (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271'),
  (SELECT jsonb_agg(to_jsonb(q) ORDER BY source_revision) FROM public.tracker_historical_display_queue q WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271')
 )::text);
$$;
SELECT set_config('card.before',pg_temp.card_fingerprint(),true);
SELECT set_config('request.jwt.claim.sub','a364de8e-06b1-4428-a20d-ac614ec406e5',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; name text; BEGIN
 FOREACH name IN ARRAY ARRAY['_tracker_card_board_source_v1','_tracker_card_hole_source_v1'] LOOP
  EXECUTE format('SELECT public.%I(NULL,''[]''::jsonb,auth.uid(),true)',name) INTO r;
  ASSERT r->>'error'='voice_delegation_required','browser may not choose delegated Voice branch';
  EXECUTE format('SELECT public.%I(NULL,''[]''::jsonb,auth.uid(),NULL)',name) INTO r;
  ASSERT r->>'error'='voice_delegation_required','NULL is not an implicit delegation mode';
 END LOOP;
 r:=public.update_community_cards('83d02eb2-8f65-4172-a94f-fa34c322e271','[]','11111111-1111-4111-8111-111111111111');
 ASSERT r->>'error'='actor_mismatch';
 r:=public.show_hole_cards('83d02eb2-8f65-4172-a94f-fa34c322e271','[]','11111111-1111-4111-8111-111111111111');
 ASSERT r->>'error'='actor_mismatch';
 r:=public.update_community_cards('83d02eb2-8f65-4172-a94f-fa34c322e271','[]',auth.uid());
 ASSERT r->>'error'='Hand is not in progress','completed hand cannot be rewritten through legacy board endpoint';
 r:=public.show_hole_cards('83d02eb2-8f65-4172-a94f-fa34c322e271','[]',auth.uid());
 ASSERT r->>'error'='hand_not_in_progress','completed hand cannot be rewritten through legacy hole endpoint';
 r:=public.get_tracker_voice_runtime_context('829e61fe-0ac8-4ced-950d-ab76cb8dadc5','8369beb2-7249-4ca8-9cc1-bc9a41f49f50');
 ASSERT r->>'error'='voice_table_session_not_tracker' AND r->'ok'='false'::jsonb
  AND r->'read_only'='true'::jsonb AND r->'can_mint_session'='false'::jsonb,
  'closed/released session retained Voice mint authority';
 ASSERT pg_temp.card_fingerprint()=current_setting('card.before'),'owner denied calls changed source/proof/queue';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; n int; BEGIN
 r:=public.update_community_cards('83d02eb2-8f65-4172-a94f-fa34c322e271','[]',auth.uid());
 ASSERT r->>'error' IN('Hand not found','actor_not_allowed');
 r:=public.show_hole_cards('83d02eb2-8f65-4172-a94f-fa34c322e271','[]',auth.uid());
 ASSERT r->>'error' IN('hand_not_found','actor_not_allowed');
 UPDATE public.tournament_hands SET pot_size=pot_size+1 WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271';
 GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=0,'outsider changed parent source';
 UPDATE public.hand_actions SET hand_id=hand_id WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271';
 GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=0,'outsider changed actions';
 UPDATE public.hand_players SET hand_id=hand_id WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271';
 GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=0,'outsider changed participants';
 ASSERT pg_temp.card_fingerprint()=current_setting('card.before'),'outsider calls changed source/proof/queue';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.update_community_cards('83d02eb2-8f65-4172-a94f-fa34c322e271','[]',NULL);
 ASSERT r->>'error'='unauthenticated';
 r:=public.show_hole_cards('83d02eb2-8f65-4172-a94f-fa34c322e271','[]',NULL);
 ASSERT r->>'error'='unauthenticated';
 r:=public.get_tracker_voice_runtime_context('829e61fe-0ac8-4ced-950d-ab76cb8dadc5','8369beb2-7249-4ca8-9cc1-bc9a41f49f50');
 ASSERT r->>'error'='unauthorized' AND r->'ok'='false'::jsonb;
 ASSERT pg_temp.card_fingerprint()=current_setting('card.before');
END $$;
RESET ROLE;
DO $$ DECLARE name text; signature text; BEGIN
 FOREACH name IN ARRAY ARRAY['_tracker_card_board_source_v1','_tracker_card_hole_source_v1'] LOOP
  signature:='public.'||name||'(uuid,jsonb,uuid,boolean)';
  ASSERT NOT has_function_privilege('anon',signature,'EXECUTE');
  ASSERT NOT has_function_privilege('service_role',signature,'EXECUTE');
  ASSERT EXISTS(SELECT 1 FROM pg_proc WHERE oid=signature::regprocedure AND NOT prosecdef
   AND proconfig=ARRAY['search_path=""']::text[] AND pg_get_userbyid(proowner)='postgres' AND pronargdefaults=0);
 END LOOP;
 ASSERT pg_temp.card_fingerprint()=current_setting('card.before');
END $$;
ROLLBACK;
\echo CARD_OWNER_OUTSIDER_FORGED_DELEGATION_COMPLETED_HAND_AND_CLOSED_VOICE_ZERO_DELTA_PASS
