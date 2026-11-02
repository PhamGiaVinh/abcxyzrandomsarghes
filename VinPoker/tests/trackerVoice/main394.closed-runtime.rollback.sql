\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
CREATE TEMP TABLE main394_scope AS
 SELECT tt.id table_id,tt.tournament_id,s.id session_id FROM public.table_sessions s
 JOIN public.tournament_tables tt ON tt.table_session_id=s.id
 WHERE s.id=ANY(ARRAY['c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55','0f8ed188-785b-4105-a8c2-6a93f6192f01',
  '9e586a50-61a8-440f-81df-27839c7ba81a','ca3c62fa-b4c5-4739-b571-5560dce53036','4bfd849b-8706-4799-9bea-f30fd1e08d8c']::uuid[])
 AND s.closed_at IS NOT NULL AND s.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
DO $$ BEGIN ASSERT (SELECT count(*) FROM main394_scope)=5,'main394_exact_five_closed_session_graph';END $$;
GRANT SELECT ON main394_scope TO authenticated;
CREATE TEMP TABLE main394_facts AS SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.table_sessions t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.dealer_assignments t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.dealer_attendance t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tracker_voice_configs t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_hands t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.hand_actions t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_prize_payments t)) facts;
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor uuid; row_data record; response jsonb; checks integer:=0; BEGIN
 FOREACH actor IN ARRAY ARRAY['675fe35e-60a8-4452-bb90-e79486d54da6'::uuid,'ce8f0306-11e4-4f3b-95cb-351841e2df59'::uuid] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  FOR row_data IN SELECT * FROM main394_scope LOOP
   response:=public.get_tracker_voice_runtime_context(row_data.tournament_id,row_data.table_id);
   ASSERT response->>'ok'='false' AND response->>'read_only'='true' AND response->>'can_mint_session'='false',
    'main394_closed_session_voice_available';
   ASSERT response->>'error'='voice_table_session_not_tracker','main394_unexpected_closed_reason';
   checks:=checks+1;
  END LOOP;
 END LOOP;
 ASSERT checks=10;
 RAISE NOTICE 'MAIN394_OWNER_OUTSIDER_FIVE_CLOSED_SESSION_VOICE_RUNTIME_DENIED_10_PASS';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT facts FROM main394_facts)=jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.table_sessions t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.dealer_assignments t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.dealer_attendance t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tracker_voice_configs t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_hands t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.hand_actions t),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_prize_payments t));
END $$;
ROLLBACK;
