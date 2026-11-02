BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT count(*) FROM public.tournament_settlement_outcomes o
  CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s
  WHERE o.hand_id='65e9cd23-c25e-4491-9c46-9b01c79676cf' AND o.source_revision=9
   AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash
   AND o.status='verified' AND o.verification_scope='historical_display')=1;
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='65e9cd23-c25e-4491-9c46-9b01c79676cf' AND source_revision=9 AND status='completed');
END $$;
SET LOCAL ROLE anon;
DO $$ DECLARE item jsonb;BEGIN
 SELECT x INTO STRICT item FROM jsonb_array_elements(public.get_public_tournament_table_history_v2(
  '46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL)->'items') x
  WHERE x->>'handId'='65e9cd23-c25e-4491-9c46-9b01c79676cf';
 ASSERT item#>>'{result,status}'='verified';
 ASSERT jsonb_array_length(item#>'{result,recipients}')=1;
 ASSERT item#>>'{result,recipients,0,playerId}'='533feda3-28c5-4194-bdf3-53a07c41305b';
 ASSERT (item#>>'{result,recipients,0,potAward}')::bigint=200;
 ASSERT (item#>>'{result,recipients,0,netDelta}')::bigint=100;
 ASSERT item#>'{result,recipients,0,holeCards}'='[]'::jsonb;
 RAISE NOTICE 'HISTORY473_HAND33_REV9_HASH_CURRENT_ANON_WINNER200_NET100_NO_HOLE_LEAK_PASS';
END $$;
ROLLBACK;
