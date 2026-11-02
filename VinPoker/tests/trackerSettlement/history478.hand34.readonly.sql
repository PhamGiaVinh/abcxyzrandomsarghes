BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
  AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
  CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s
  WHERE o.hand_id='b3414623-e129-4c0a-99ce-37a5915bb511' AND o.source_revision=19
   AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash
   AND o.status='verified' AND o.verification_scope='historical_display');
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue
  WHERE hand_id='b3414623-e129-4c0a-99ce-37a5915bb511' AND source_revision=19 AND status='completed');
END $$;
SET LOCAL ROLE anon;
DO $$ DECLARE item jsonb; BEGIN
 SELECT x INTO STRICT item FROM jsonb_array_elements(public.get_public_tournament_table_history_v2(
  '46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL)->'items') x
  WHERE x->>'handId'='b3414623-e129-4c0a-99ce-37a5915bb511';
 ASSERT item->'board'='["As","Kh","Qd","7c","2d"]'::jsonb;
 ASSERT item#>>'{result,status}'='verified';
 ASSERT jsonb_array_length(item#>'{result,recipients}')=1;
 ASSERT item#>>'{result,recipients,0,playerId}'='5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103';
 ASSERT (item#>>'{result,recipients,0,potAward}')::bigint=400;
 ASSERT (item#>>'{result,recipients,0,netDelta}')::bigint=200;
 ASSERT item#>'{result,recipients,0,holeCards}'='[]'::jsonb;
 RAISE NOTICE 'HISTORY478_HAND34_REV19_CURRENT_PROOF_ANON_BOARD5_WINNER400_NET200_NO_HOLES_PASS';
END $$;
ROLLBACK;
