-- Caller owns BEGIN/ROLLBACK, exact retained linked D2 journey.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE context jsonb; numbers integer[];
BEGIN
 context:=public.get_tracker_hand_input_tables_v4('4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT context->>'ok'='true' AND jsonb_array_length(context->'tables')=3;
 SELECT array_agg((t->>'table_number')::integer ORDER BY (t->>'table_number')::integer) INTO numbers
  FROM jsonb_array_elements(context->'tables') t;
 ASSERT numbers=ARRAY[7,8,9],'CANONICAL_NUMBERS_NOT_IN_READ_CONTRACT';
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'tables') t
  WHERE t->>'table_number'='8' AND t->>'table_id'='f905f5dc-6d26-454b-8c7c-2e31840e1f8f'
   AND t->>'tournament_table_id'='e16d00d3-8537-45e1-893c-fc1f574ea17c'
   AND t->>'table_session_id'='ca3c62fa-b4c5-4739-b571-5560dce53036'
   AND t->>'control_epoch'='2' AND t->>'can_manual_cards'='true' AND t->>'player_count'='4');
END $$;
RESET ROLE;
-- A canonical asset cannot be turned into a legacy fixture by clearing its
-- number. Assert the existing identity guard rather than bypassing it.
DO $$ BEGIN
 BEGIN
  UPDATE public.game_tables SET table_number=NULL WHERE id='f905f5dc-6d26-454b-8c7c-2e31840e1f8f';
  RAISE EXCEPTION 'expected_canonical_number_guard';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='numbered physical table cannot lose its number',SQLERRM; END;
 ASSERT (SELECT table_number FROM public.game_tables WHERE id='f905f5dc-6d26-454b-8c7c-2e31840e1f8f')=8;
END $$;
SET LOCAL request.jwt.claim.sub='3add8ca8-34ff-4f52-8b40-a48c192d3aa5';
SET LOCAL request.jwt.claims='{"sub":"3add8ca8-34ff-4f52-8b40-a48c192d3aa5","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE context jsonb;
BEGIN
 context:=public.get_tracker_hand_input_tables_v4('4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT context->>'ok'='false' AND context->>'error'='actor_not_allowed';
END $$;
RESET ROLE;
SELECT 'TRACKER186_CANONICAL_NUMBER_SCOPE_SESSION_CAPABILITY_PASS';
