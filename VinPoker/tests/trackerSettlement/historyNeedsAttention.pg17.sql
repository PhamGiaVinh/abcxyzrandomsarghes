\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_finish97_ci','vinpoker_ops_history98_ci','vinpoker_ops_history98_rollback') OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
 RAISE EXCEPTION 'isolated_history_attention_fixture_required'; END IF;
END $$;
UPDATE public.tournament_hands SET status='completed',is_voided=false,tracker_small_blind=NULL,tracker_big_blind=NULL
 WHERE id='86000000-0000-4000-8000-000000000001';
UPDATE public.tracker_historical_display_queue q SET status='needs_attention',lease_token=NULL,lease_until=NULL,
 last_error_code='PRIVATE_DIAGNOSTIC_MUST_NOT_BE_PUBLIC'
 FROM public.tournament_hands h WHERE q.hand_id=h.id AND q.source_revision=h.source_revision
 AND h.id='86000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h
 ON q.hand_id=h.id AND q.source_revision=h.source_revision WHERE h.id='86000000-0000-4000-8000-000000000001'
 AND q.status='needs_attention') THEN RAISE EXCEPTION 'attention_fixture_missing'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ DECLARE response jsonb; item jsonb; BEGIN
 response:=public.get_public_tournament_table_history_v2('85000000-0000-4000-8000-000000000001',
 '84000000-0000-4000-8000-000000000001',20,NULL,NULL);
 SELECT value INTO item FROM jsonb_array_elements(response->'items') WHERE value->>'handId'='86000000-0000-4000-8000-000000000001';
 IF item IS NULL THEN RAISE EXCEPTION 'public_history_fixture_not_visible'; END IF;
 IF item->'result'->>'status' IS DISTINCT FROM 'needs_attention' THEN
 RAISE EXCEPTION 'HISTORY_NEEDS_ATTENTION_COLLAPSED_TO_PENDING'; END IF;
 IF response::text LIKE '%PRIVATE_DIAGNOSTIC%' THEN RAISE EXCEPTION 'private_queue_error_exposed'; END IF;
END $$;
SET LOCAL ROLE NONE;
UPDATE public.tracker_historical_display_queue q SET status='pending',last_error_code=NULL
 FROM public.tournament_hands h WHERE q.hand_id=h.id AND q.source_revision=h.source_revision
 AND h.id='86000000-0000-4000-8000-000000000001';
INSERT INTO public.tracker_historical_display_queue(hand_id,source_revision,status,last_error_code)
 SELECT id,source_revision-1,'needs_attention','PRIVATE_OLD_REVISION' FROM public.tournament_hands
 WHERE id='86000000-0000-4000-8000-000000000001'
 ON CONFLICT(hand_id,source_revision) DO UPDATE SET status='needs_attention',lease_token=NULL,lease_until=NULL;
SET LOCAL ROLE anon;
DO $$ DECLARE response jsonb; item jsonb; BEGIN
 response:=public.get_public_tournament_table_history_v2('85000000-0000-4000-8000-000000000001',
 '84000000-0000-4000-8000-000000000001',20,NULL,NULL);
 SELECT value INTO item FROM jsonb_array_elements(response->'items') WHERE value->>'handId'='86000000-0000-4000-8000-000000000001';
 IF item->'result'->>'status' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'old_attention_revision_published'; END IF;
 IF has_table_privilege('anon','public.tracker_historical_display_queue','SELECT') THEN RAISE EXCEPTION 'queue_acl_broadened'; END IF;
END $$;
SET LOCAL ROLE NONE;
-- Synthetic stored-proof fixture tests projection precedence only, not poker
-- correctness or acceptance of a proof by the worker commit RPC.
UPDATE public.tournament_hands SET tracker_small_blind=50,tracker_big_blind=100,tracker_bba=0
 WHERE id='86000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_settlement_outcomes(tournament_id,hand_id,source_revision,source_chain_hash,
 settlement_revision,outcome_hash,public_outcome,request_hash,idempotency_key,actor_user_id,verification_scope)
 SELECT h.tournament_id,h.id,s.source_revision,s.source_chain_hash,987654,repeat('a',64),
 jsonb_build_object('players',jsonb_build_array(jsonb_build_object('playerId',p.player_id,'potAward',100,'netDelta',100)),
 'pots',jsonb_build_array(jsonb_build_object('kind','main','allocations',jsonb_build_array(jsonb_build_object('winnerId',p.player_id,'amount',100))))),
 repeat('b',64),'history98-synthetic-projection-priority','81100000-0000-4000-8000-000000000001','historical_display'
 FROM public.tournament_hands h CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s
 JOIN LATERAL(SELECT player_id FROM public.hand_players WHERE hand_id=h.id ORDER BY seat_number LIMIT 1) p ON true
 WHERE h.id='86000000-0000-4000-8000-000000000001';
UPDATE public.tracker_historical_display_queue q SET status='needs_attention',lease_token=NULL,lease_until=NULL
 FROM public.tournament_hands h WHERE q.hand_id=h.id AND q.source_revision=h.source_revision
 AND h.id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
DO $$ DECLARE response jsonb; BEGIN
 response:=public.get_public_tournament_table_history_v2('85000000-0000-4000-8000-000000000001',
 '84000000-0000-4000-8000-000000000001',20,NULL,NULL);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(response->'items') item WHERE item->>'handId'='86000000-0000-4000-8000-000000000001'
 AND item->'result'->>'status'='verified') THEN RAISE EXCEPTION 'matching_verified_proof_lost_priority'; END IF;
END $$;
SET LOCAL ROLE NONE;
UPDATE public.tournament_hands SET pot_size=coalesce(pot_size,0)+1 WHERE id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
DO $$ DECLARE response jsonb; BEGIN
 response:=public.get_public_tournament_table_history_v2('85000000-0000-4000-8000-000000000001',
 '84000000-0000-4000-8000-000000000001',20,NULL,NULL);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(response->'items') item WHERE item->>'handId'='86000000-0000-4000-8000-000000000001'
 AND item->'result'->>'status'='pending') THEN RAISE EXCEPTION 'correction_revived_old_proof_or_attention'; END IF;
END $$;
ROLLBACK;
\echo HISTORY_NEEDS_ATTENTION_DISTINCT_PUBLIC_STATE_PASS
