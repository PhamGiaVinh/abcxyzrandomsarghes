\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_finish94_unified','vinpoker_ops_finish95_unified','vinpoker_ops_finish95_qualified','vinpoker_ops_finish95_ci','vinpoker_ops_finish96_qualified','vinpoker_ops_finish96_ci') OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'finish95_isolated_fixture_required'; END IF;
END $$;
UPDATE public.tournament_hands SET status='in_progress',is_voided=false,locked_by_user_id='81400000-0000-4000-8000-000000000001',locked_at=now()
 WHERE id='86000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
CREATE FUNCTION public.manual_finish95_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.operation_type='record_tracker_manual_hand_v1' AND current_setting('vinpoker.test_finish95_fault',true)='true' THEN
  RAISE EXCEPTION 'manual_finish95_receipt_fault'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER manual_finish95_receipt_fault BEFORE INSERT ON public.table_operation_receipts
 FOR EACH ROW EXECUTE FUNCTION public.manual_finish95_test_fault();
DO $$ DECLARE intent jsonb; verdict jsonb; replayed jsonb; before_state text; after_state text; epoch bigint;
 snapshot_sql text:=$snapshot$ SELECT jsonb_build_object(
 'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_hands x),
 'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.player_id,x.entry_number) FROM public.hand_players x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_seats x),
 'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_entries x),
 'chips',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tournament_id,x.player_id,x.entry_number) FROM public.tournament_chip_counts x),
 'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.source_revision) FROM public.tracker_historical_display_queue x),
 'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.actor_id,x.operation_type,x.request_id) FROM public.table_operation_receipts x))::text $snapshot$;
BEGIN
 SELECT s.control_epoch INTO epoch FROM public.table_sessions s WHERE s.id='83500000-0000-4000-8000-000000000001';
 SELECT jsonb_build_object('actor_id','81400000-0000-4000-8000-000000000001','request_id',gen_random_uuid(),
  'tournament_id',h.tournament_id,'tournament_table_id',h.tournament_table_id,'hand_id',h.id,
  'table_session_id',h.table_session_id,'control_epoch',epoch,'source_revision',h.source_revision,
  'payload',jsonb_build_object('hand_time',now(),'players',(SELECT jsonb_agg(jsonb_build_object(
   'player_id',p.player_id,'entry_number',p.entry_number,'seat_number',p.seat_number,'starting_stack',p.starting_stack,
   'ending_stack',p.starting_stack,'is_eliminated',false,'hole_cards','[]'::jsonb)) FROM public.hand_players p WHERE p.hand_id=h.id),
   'actions','[]'::jsonb,'side_pots','[]'::jsonb,'community_cards','[]'::jsonb,'pot_size',0))
 INTO intent FROM public.tournament_hands h WHERE h.id='86000000-0000-4000-8000-000000000001';
 IF intent IS NULL THEN RAISE EXCEPTION 'manual_finish95_fixture_missing'; END IF;
 IF NOT has_function_privilege('authenticated','public.record_tracker_manual_hand_v1(jsonb)','EXECUTE')
 OR has_function_privilege('anon','public.record_tracker_manual_hand_v1(jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.record_tracker_manual_hand_v1(jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.get_tracker_manual_finish_receipt_v1(jsonb)','EXECUTE')
 OR has_function_privilege('anon','public.get_tracker_manual_finish_receipt_v1(jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.get_tracker_manual_finish_receipt_v1(jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'manual_finish95_acl_wrong'; END IF;
 EXECUTE snapshot_sql INTO before_state;
 PERFORM set_config('role','authenticated',true);
 verdict:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{actor_id}','"81100000-0000-4000-8000-000000000001"'));
 IF verdict->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'manual_finish95_wrong_actor_accepted: %',verdict; END IF;
 verdict:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{tournament_id}','"85000000-0000-4000-8000-000000000002"'));
 IF verdict->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'manual_finish95_cross_club_accepted: %',verdict; END IF;
 verdict:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{request_id}','"invalid-uuid"'));
 IF verdict->>'error' IS DISTINCT FROM 'invalid_finish_intent' THEN RAISE EXCEPTION 'manual_finish95_malformed_key_accepted: %',verdict; END IF;
 verdict:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{payload,players}','{}'));
 IF verdict->>'error' IS DISTINCT FROM 'invalid_finish_intent' THEN RAISE EXCEPTION 'manual_finish95_malformed_payload_accepted: %',verdict; END IF;
 verdict:=public.get_tracker_manual_finish_receipt_v1(intent);
 IF verdict->>'error' IS DISTINCT FROM 'receipt_not_found' THEN RAISE EXCEPTION 'manual_finish95_missing_receipt_invented: %',verdict; END IF;
 verdict:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{source_revision}',to_jsonb((intent->>'source_revision')::bigint+1)));
 IF verdict->>'error' IS DISTINCT FROM 'stale_manual_finish_context' THEN RAISE EXCEPTION 'manual_finish95_stale_revision_accepted: %',verdict; END IF;
 verdict:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{table_session_id}','"83500000-0000-4000-8000-000000000002"'));
 IF verdict->>'error' IS DISTINCT FROM 'stale_manual_finish_context' THEN RAISE EXCEPTION 'manual_finish95_wrong_session_accepted: %',verdict; END IF;
 PERFORM set_config('role','none',true);
 EXECUTE snapshot_sql INTO after_state;
 IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'manual_finish95_denial_changed_state'; END IF;
 UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id='83500000-0000-4000-8000-000000000001';
 PERFORM set_config('role','authenticated',true);
 verdict:=public.record_tracker_manual_hand_v1(intent);
 IF verdict->>'error' IS DISTINCT FROM 'stale_manual_finish_context' THEN RAISE EXCEPTION 'manual_finish95_stale_epoch_accepted: %',verdict; END IF;
 PERFORM set_config('role','none',true);
 UPDATE public.table_sessions SET control_epoch=epoch WHERE id='83500000-0000-4000-8000-000000000001';
 EXECUTE snapshot_sql INTO before_state;
 PERFORM set_config('vinpoker.test_finish95_fault','true',true);
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.record_tracker_manual_hand_v1(intent);
  RAISE EXCEPTION 'manual_finish95_receipt_fault_not_observed';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'manual_finish95_receipt_fault' THEN RAISE; END IF;
 END;
 PERFORM set_config('role','none',true);
 EXECUTE snapshot_sql INTO after_state;
 IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'manual_finish95_receipt_fault_partial_commit'; END IF;
 PERFORM set_config('vinpoker.test_finish95_fault','false',true);
 PERFORM set_config('role','authenticated',true);
 verdict:=public.record_tracker_manual_hand_v1(intent);
 IF verdict->>'ok' IS DISTINCT FROM 'true' OR verdict->'intent' IS DISTINCT FROM intent THEN
  RAISE EXCEPTION 'manual_finish95_positive_failed: %',verdict; END IF;
 replayed:=public.record_tracker_manual_hand_v1(intent);
 IF replayed IS DISTINCT FROM verdict THEN RAISE EXCEPTION 'manual_finish95_replay_changed'; END IF;
 replayed:=public.get_tracker_manual_finish_receipt_v1(intent);
 IF replayed IS DISTINCT FROM verdict THEN RAISE EXCEPTION 'manual_finish95_reconcile_changed'; END IF;
 replayed:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{payload,pot_size}','1'));
 IF replayed->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'manual_finish95_changed_payload_accepted'; END IF;
 replayed:=public.get_tracker_manual_finish_receipt_v1(jsonb_set(intent,'{payload,pot_size}','1'));
 IF replayed->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'manual_finish95_changed_receipt_payload_accepted'; END IF;
 PERFORM set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
 replayed:=public.get_tracker_manual_finish_receipt_v1(intent);
 IF replayed->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'manual_finish95_foreign_actor_receipt_visible'; END IF;
 replayed:=public.get_tracker_manual_finish_receipt_v1(jsonb_set(intent,'{actor_id}','"81100000-0000-4000-8000-000000000001"'));
 IF replayed->>'error' IS DISTINCT FROM 'receipt_not_found' THEN RAISE EXCEPTION 'manual_finish95_foreign_actor_key_visible'; END IF;
 PERFORM set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.table_operation_receipts WHERE operation_type='record_tracker_manual_hand_v1' AND request_id=(intent->>'request_id')::uuid)<>1 THEN
  RAISE EXCEPTION 'manual_finish95_duplicate_receipt'; END IF;
 UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id='83500000-0000-4000-8000-000000000001';
 PERFORM set_config('role','authenticated',true);
 replayed:=public.get_tracker_manual_finish_receipt_v1(intent);
 IF replayed IS DISTINCT FROM verdict THEN RAISE EXCEPTION 'manual_finish95_past_commit_proof_lost'; END IF;
END $$;
ROLLBACK;
\echo MANUAL_FINISH95_EXACT_INTENT_RECEIPT_ATOMIC_PASS
