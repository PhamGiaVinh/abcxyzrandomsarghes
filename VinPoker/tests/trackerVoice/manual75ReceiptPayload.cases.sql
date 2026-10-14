DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_manual_card75_release_20261014','vinpoker_manual_card75_rollback_20261014','vinpoker_manual_card75_payload_20261014')
 OR current_user<>'postgres' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55464 OR current_setting('manual75.fixture',true) IS DISTINCT FROM 'owned-manual-authority'
 THEN RAISE EXCEPTION 'owned_manual75_payload_harness_required'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',false);
SELECT public.get_tracker_manual_card_receipt_v1('manual-prototype-key-0001',jsonb_build_object(
 'hand_id','86000000-0000-4000-8000-000000000001','table_session_id','83500000-0000-4000-8000-000000000001',
 'control_epoch',1,'expected_source_revision',:manual_before_revision,'player_hole_cards',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb))::text AS payload \gset receipt_payload_mismatch_
RESET ROLE;
SELECT pg_temp.manual_assert(:'receipt_payload_mismatch_payload'::jsonb->>'error'='idempotency_conflict'
 AND (SELECT count(*)=1 FROM floor_private.tracker_manual_card_receipts_v1)
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT hole_cards='["Qh","Qs"]'::jsonb FROM public.hand_players
  WHERE hand_id='86000000-0000-4000-8000-000000000001' AND seat_number=2),
 'same actor key with different cards cannot reconcile a different intent; zero writes');
\echo MANUAL75_RECEIPT_PAYLOAD_MISMATCH_ZERO_WRITE_PASS
-- Restore only the transaction-local synthetic assignment; inactive identity is
-- independently invalid even when attendance/session still appear assigned.
UPDATE public.dealer_assignments SET status='assigned',released_at=NULL
 WHERE id='88000000-0000-4000-8000-000000000001';
UPDATE public.dealers SET status='inactive' WHERE id='87000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT public.show_tracker_manual_cards_v1('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_after_revision,'manual75-inactive-new-key',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]'::jsonb)::text AS payload \gset inactive_new_
SELECT public.show_tracker_manual_cards_v1('86000000-0000-4000-8000-000000000001',
 '83500000-0000-4000-8000-000000000001',1,:manual_before_revision,'manual-prototype-key-0001',
 '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Qh","Qs"]}]'::jsonb)::text AS payload \gset inactive_replay_
RESET ROLE;
SELECT pg_temp.manual_assert(:'inactive_new_payload'::jsonb->>'error'='actor_not_allowed'
 AND :'inactive_replay_payload'::jsonb->>'error'='actor_not_allowed'
 AND (SELECT count(*)=1 FROM floor_private.tracker_manual_card_receipts_v1)
 AND (SELECT source_revision=:manual_after_revision FROM public.tournament_hands
  WHERE id='86000000-0000-4000-8000-000000000001')
 AND (SELECT hole_cards='["Qh","Qs"]'::jsonb FROM public.hand_players
  WHERE hand_id='86000000-0000-4000-8000-000000000001' AND seat_number=2),
 'inactive assigned Dealer cannot write or replay mutation; zero writes');
\echo MANUAL75_INACTIVE_DEALER_ZERO_WRITE_PASS
