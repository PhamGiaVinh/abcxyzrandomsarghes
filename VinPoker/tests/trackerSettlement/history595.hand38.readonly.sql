BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o
 CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s
 WHERE o.hand_id='7080b766-b07b-41c5-b4f5-d3350cc505d5' AND o.source_revision=9
 AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash
 AND o.status='verified' AND o.verification_scope='historical_display'
 AND o.public_outcome#>>'{totals,refundTotal}'='100'
 AND o.public_outcome#>>'{totals,startingStack}'='60000'
 AND o.public_outcome#>>'{totals,endingStack}'='60000');
 ASSERT (SELECT count(*)=1 FROM public.tournament_settlement_outcomes WHERE hand_id='7080b766-b07b-41c5-b4f5-d3350cc505d5');
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='7080b766-b07b-41c5-b4f5-d3350cc505d5' AND source_revision=9 AND status='completed');
 ASSERT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'history_worker_%');
END $$;
SET LOCAL ROLE anon;
DO $$ DECLARE item jsonb;BEGIN
 SELECT x INTO STRICT item FROM jsonb_array_elements(public.get_public_tournament_table_history_v2(
 '46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',20,NULL,NULL)->'items') x
 WHERE x->>'handId'='7080b766-b07b-41c5-b4f5-d3350cc505d5';
 ASSERT item->'board'='[]'::jsonb AND item->>'pot'='200';
 ASSERT item#>>'{result,status}'='verified';
 ASSERT jsonb_array_length(item#>'{result,recipients}')=1;
 ASSERT item#>>'{result,recipients,0,playerId}'='5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103';
 ASSERT item#>>'{result,recipients,0,potAward}'='200';
 ASSERT item#>>'{result,recipients,0,netDelta}'='100';
 ASSERT item#>'{result,recipients,0,holeCards}'='[]'::jsonb;
 RAISE NOTICE 'HISTORY595_HAND38_CURRENT_REV9_ANON_FOLD_POT200_NET100_NO_PRIVATE_CARDS_PASS';
END $$;
ROLLBACK;
