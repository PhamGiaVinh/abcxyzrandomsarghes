-- Actual browser cancellation + canonical Finish checkpoint; no synthetic receipts.
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='7080b766-b07b-41c5-b4f5-d3350cc505d5' AND hand_number=38 AND status='completed' AND source_revision=9 AND pot_size=200);
 ASSERT (SELECT count(*)=1 FROM private.tracker_undo_intent_cancellations_v1 WHERE actor_user_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND idempotency_key='d69b3aed-ab90-42db-93fd-633e7903427e' AND receipt->>'hand_id'='7080b766-b07b-41c5-b4f5-d3350cc505d5' AND receipt->>'expected_action_id'='aa364f28-b2a2-4793-b383-6c9c8322fe01' AND receipt->>'expected_source_revision'='6');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_correction_operations WHERE actor_user_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND idempotency_key='d69b3aed-ab90-42db-93fd-633e7903427e');
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE operation_type='record_tracker_manual_hand_v1' AND request_id='c912c011-76ef-4244-bbc3-e3243d4a091f' AND result->>'hand_id'='7080b766-b07b-41c5-b4f5-d3350cc505d5' AND result->>'starting_total'='60000' AND result->>'ending_total'='60000');
 ASSERT (SELECT array_agg(ending_stack ORDER BY seat_number)=ARRAY[58900,1100]::integer[] FROM public.hand_players WHERE hand_id='7080b766-b07b-41c5-b4f5-d3350cc505d5');
 ASSERT (SELECT array_agg(action_type::text ORDER BY action_order)=ARRAY['post_sb','post_bb','fold'] AND sum(action_amount)=300 FROM public.hand_actions WHERE hand_id='7080b766-b07b-41c5-b4f5-d3350cc505d5');
 ASSERT EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE id='9f76148b-189e-4af7-b4b6-8f8111242c7d' AND enabled=false);
 ASSERT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND auto_swing_enabled=false);
 RAISE NOTICE 'HAND594_BROWSER_CANCELLED_ORIGINAL_UNDO_FINISHED_ONCE_CONSERVED_SCOPE_OFF_PASS';
END $$;
ROLLBACK;
