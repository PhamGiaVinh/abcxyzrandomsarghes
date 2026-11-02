BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
  CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s
  WHERE o.hand_id='3787718f-ef28-485d-aef6-342241c6fe40' AND o.source_revision=15
   AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash
   AND o.status='verified' AND o.verification_scope='historical_display');
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='3787718f-ef28-485d-aef6-342241c6fe40' AND source_revision=15 AND status='completed');
END $$;
SET LOCAL ROLE anon;
DO $$ DECLARE item jsonb;BEGIN
 SELECT x INTO STRICT item FROM jsonb_array_elements(public.get_public_tournament_table_history_v2(
  '46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL)->'items') x
  WHERE x->>'handId'='3787718f-ef28-485d-aef6-342241c6fe40';
 ASSERT item->'board'='["2c","3d","4h","5s","6c"]'::jsonb;
 ASSERT item#>>'{result,status}'='verified';
 ASSERT jsonb_array_length(item#>'{result,recipients}')=2;
 ASSERT (SELECT bool_and((x->>'potAward')::bigint=1100 AND (x->>'netDelta')::bigint=0)
  FROM jsonb_array_elements(item#>'{result,recipients}') x);
 ASSERT (SELECT array_agg(x->>'playerId' ORDER BY x->>'playerId')=ARRAY['533feda3-28c5-4194-bdf3-53a07c41305b','5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103']
  FROM jsonb_array_elements(item#>'{result,recipients}') x);
 RAISE NOTICE 'HISTORY555_HAND35_CURRENT_REV15_ANON_BOARD_PLAYS_1100_EACH_NET_ZERO_PASS';
END $$;
ROLLBACK;
