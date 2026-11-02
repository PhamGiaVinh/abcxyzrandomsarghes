\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_finish_cancel_candidate','vinpoker_ops_finish97_ci') OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
 RAISE EXCEPTION 'isolated_cancellation_fixture_required'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
CREATE FUNCTION public.manual_cancel_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.operation_type='record_tracker_manual_hand_v1' AND current_setting('vinpoker.test_cancel_fault',true)='true'
 THEN RAISE EXCEPTION 'cancel_receipt_fault'; END IF; RETURN NEW; END $$;
CREATE TRIGGER manual_cancel_test_fault BEFORE INSERT ON public.table_operation_receipts
 FOR EACH ROW EXECUTE FUNCTION public.manual_cancel_test_fault();
CREATE FUNCTION public.manual_cancel_state() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
 'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_hands x),
 'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.player_id,x.entry_number) FROM public.hand_players x),
 'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.hand_actions x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_seats x),
 'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_entries x),
 'chips',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tournament_id,x.player_id,x.entry_number) FROM public.tournament_chip_counts x),
 'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.source_revision) FROM public.tracker_historical_display_queue x),
 'outcomes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_settlement_outcomes x)) $$;
DO $$ DECLARE intent jsonb; answer jsonb; before_hand jsonb; before_state jsonb; BEGIN
 before_state:=public.manual_cancel_state();
 SELECT to_jsonb(h),jsonb_build_object('actor_id','81400000-0000-4000-8000-000000000001',
 'request_id',gen_random_uuid(),'tournament_id',h.tournament_id,'tournament_table_id',h.tournament_table_id,
 'hand_id',h.id,'table_session_id',h.table_session_id,'control_epoch',1,'source_revision',h.source_revision,
 'payload',jsonb_build_object('players','[{}]'::jsonb,'actions','[]'::jsonb,'side_pots','[]'::jsonb,
 'community_cards','[]'::jsonb,'hand_time',now(),'pot_size',0)) INTO before_hand,intent
 FROM public.tournament_hands h WHERE h.id='86000000-0000-4000-8000-000000000001';
 IF intent IS NULL THEN RAISE EXCEPTION 'fixture_missing'; END IF;
 IF has_function_privilege('anon','public.cancel_tracker_manual_finish_v1(jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.cancel_tracker_manual_finish_v1(jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.cancel_tracker_manual_finish_v1(jsonb)','EXECUTE') THEN
 RAISE EXCEPTION 'cancellation_acl_wrong'; END IF;
 PERFORM set_config('role','authenticated',true);
 answer:=public.cancel_tracker_manual_finish_v1(jsonb_set(intent,'{actor_id}','"81100000-0000-4000-8000-000000000001"'));
 IF answer->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'foreign_actor_accepted'; END IF;
 PERFORM set_config('vinpoker.test_cancel_fault','true',true);
 BEGIN
  PERFORM public.cancel_tracker_manual_finish_v1(intent);
  RAISE EXCEPTION 'receipt_fault_not_observed';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'cancel_receipt_fault' THEN RAISE; END IF; END;
 IF public.get_tracker_manual_finish_receipt_v1(intent)->>'error' IS DISTINCT FROM 'receipt_not_found'
 THEN RAISE EXCEPTION 'fault_left_tombstone'; END IF;
 PERFORM set_config('vinpoker.test_cancel_fault','false',true);
 answer:=public.cancel_tracker_manual_finish_v1(intent);
 IF answer->>'status' IS DISTINCT FROM 'cancelled' OR answer->'intent' IS DISTINCT FROM intent
 OR answer ? 'committed_source_revision' THEN RAISE EXCEPTION 'cancel_proof_wrong: %',answer; END IF;
 IF public.record_tracker_manual_hand_v1(intent) IS DISTINCT FROM answer THEN RAISE EXCEPTION 'late_writer_not_fenced'; END IF;
 IF public.get_tracker_manual_finish_receipt_v1(intent) IS DISTINCT FROM answer THEN RAISE EXCEPTION 'read_did_not_recover'; END IF;
 IF public.cancel_tracker_manual_finish_v1(intent) IS DISTINCT FROM answer THEN RAISE EXCEPTION 'cancel_replay_changed'; END IF;
 IF public.record_tracker_manual_hand_v1(jsonb_set(intent,'{payload,pot_size}','1'))->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT'
 THEN RAISE EXCEPTION 'payload_conflict_missing'; END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE h.id=(intent->>'hand_id')::uuid) IS DISTINCT FROM before_hand
 THEN RAISE EXCEPTION 'cancellation_changed_hand'; END IF;
 IF public.manual_cancel_state() IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'cancellation_changed_operational_state'; END IF;
END $$;
UPDATE public.tournament_hands SET status='in_progress',is_voided=false,
 locked_by_user_id='81400000-0000-4000-8000-000000000001',locked_at=now()
 WHERE id='86000000-0000-4000-8000-000000000001';
DO $$ DECLARE intent jsonb; committed jsonb; hand_after jsonb; BEGIN
 SELECT jsonb_build_object('actor_id','81400000-0000-4000-8000-000000000001','request_id',gen_random_uuid(),
 'tournament_id',h.tournament_id,'tournament_table_id',h.tournament_table_id,'hand_id',h.id,
 'table_session_id',h.table_session_id,'control_epoch',s.control_epoch,'source_revision',h.source_revision,
 'payload',jsonb_build_object('hand_time',now(),'players',(SELECT jsonb_agg(jsonb_build_object(
 'player_id',p.player_id,'entry_number',p.entry_number,'seat_number',p.seat_number,'starting_stack',p.starting_stack,
 'ending_stack',p.starting_stack,'is_eliminated',false,'hole_cards','[]'::jsonb)) FROM public.hand_players p WHERE p.hand_id=h.id),
 'actions','[]'::jsonb,'side_pots','[]'::jsonb,'community_cards','[]'::jsonb,'pot_size',0)) INTO intent
 FROM public.tournament_hands h JOIN public.table_sessions s ON s.id=h.table_session_id
 WHERE h.id='86000000-0000-4000-8000-000000000001';
 PERFORM set_config('role','authenticated',true);
 committed:=public.record_tracker_manual_hand_v1(intent);
 IF committed->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'positive_finish_failed: %',committed; END IF;
 PERFORM set_config('role','none',true);
 SELECT to_jsonb(h) INTO hand_after FROM public.tournament_hands h WHERE h.id=(intent->>'hand_id')::uuid;
 PERFORM set_config('role','authenticated',true);
 IF public.cancel_tracker_manual_finish_v1(intent) IS DISTINCT FROM committed THEN RAISE EXCEPTION 'cancel_replaced_commit'; END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE h.id=(intent->>'hand_id')::uuid) IS DISTINCT FROM hand_after
 THEN RAISE EXCEPTION 'cancel_after_commit_changed_hand'; END IF;
END $$;
ROLLBACK;
\echo MANUAL_FINISH_CANCEL_RECEIPT_LATE_WRITER_READ_REPLAY_PASS
