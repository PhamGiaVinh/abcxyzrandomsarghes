-- Read-only checkpoint, deliberately NOT a completed Undo/whole-hand PASS.
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='5432fdcb-1cb4-46e4-98a7-5ee6d23b0346' AND hand_number=37 AND status='completed' AND source_revision=9 AND pot_size=200);
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE operation_type='record_tracker_manual_hand_v1' AND result->>'hand_id'='5432fdcb-1cb4-46e4-98a7-5ee6d23b0346');
 ASSERT (SELECT array_agg(ending_stack ORDER BY seat_number)=ARRAY[58800,1200]::integer[] FROM public.hand_players WHERE hand_id='5432fdcb-1cb4-46e4-98a7-5ee6d23b0346');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='7080b766-b07b-41c5-b4f5-d3350cc505d5' AND hand_number=38 AND status='in_progress' AND source_revision=6);
 ASSERT (SELECT array_agg(action_type::text ORDER BY action_order)=ARRAY['post_sb','post_bb','fold'] AND sum(action_amount)=300 FROM public.hand_actions WHERE hand_id='7080b766-b07b-41c5-b4f5-d3350cc505d5');
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE operation_type='record_tracker_manual_hand_v1' AND result->>'hand_id'='7080b766-b07b-41c5-b4f5-d3350cc505d5');
 ASSERT EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE id='9f76148b-189e-4af7-b4b6-8f8111242c7d' AND enabled=false AND capability='undo_open_hand');
 ASSERT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND auto_swing_enabled=false);
 RAISE NOTICE 'HAND590_CHECKPOINT37_FINISHED_ONCE_38_UNDO_DENIED_UNCHANGED_NOT_ACCEPTED';
END $$;
ROLLBACK;
