-- Follow successful qualified Voice-first overlap; all operations roll back.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE prior public.dealer_swing_operator_requests%ROWTYPE; result jsonb; before_state text; after_state text; pending_id uuid; initial_epoch bigint; initial_revision bigint; current_assignment uuid; current_version integer;
BEGIN
 IF current_database() NOT IN ('vinpoker_voice_swing73_voice_first_qualified_20261014','vinpoker_voice_swing73_pending_20261014')
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'a25a91e02d6f2c0399e5aba1086e4acf' THEN RAISE EXCEPTION 'owned_qualified73_replay_required'; END IF;
 SELECT * INTO STRICT prior FROM public.dealer_swing_operator_requests WHERE request_id='89000000-0000-4000-8000-000000000073';
 SELECT id,version INTO STRICT current_assignment,current_version FROM public.dealer_assignments WHERE table_id=prior.table_id AND status='assigned' AND released_at IS NULL;
 -- Synthetic closed incarnation only; not proof of a real close/reopen flow.
 INSERT INTO public.table_sessions SELECT (jsonb_populate_record(NULL::public.table_sessions,to_jsonb(s)||jsonb_build_object('id','83500000-0000-4000-8000-000000000073','closed_at',now(),'closed_by','81100000-0000-4000-8000-000000000001'))).* FROM public.table_sessions s WHERE s.id=prior.table_session_id;
 IF prior.response->>'outcome' IS DISTINCT FROM 'swung' THEN RAISE EXCEPTION 'canonical_swing_receipt_required'; END IF;
 SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a),'requests',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.request_id) FROM public.dealer_swing_operator_requests a),'voice',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.tracker_voice_events a))::text) INTO before_state;
 PERFORM set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims','{"sub":"81100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 result:=public.operator_perform_swing(prior.table_id,prior.table_session_id,prior.assignment_id,prior.expected_version,prior.request_id);
 IF result IS DISTINCT FROM prior.response||jsonb_build_object('idempotent',true) THEN RAISE EXCEPTION 'same_payload_replay_changed_result'; END IF;
 BEGIN
  PERFORM public.operator_perform_swing(prior.table_id,prior.table_session_id,prior.assignment_id,prior.expected_version+1,prior.request_id);
  RAISE EXCEPTION 'conflicting_payload_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SWING_IDEMPOTENCY_CONFLICT' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.operator_perform_swing(prior.table_id,prior.table_session_id,prior.assignment_id,prior.expected_version,'89000000-0000-4000-8000-000000000075');
  RAISE EXCEPTION 'completed_assignment_reused';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SWING_ASSIGNMENT_CONTEXT_MISMATCH' THEN RAISE; END IF; END;
 RESET ROLE;
 SET LOCAL ROLE authenticated;
 BEGIN
  PERFORM public.operator_perform_swing(prior.table_id,'83500000-0000-4000-8000-000000000073',current_assignment,current_version,'89000000-0000-4000-8000-000000000077');
  RAISE EXCEPTION 'closed_session_reused';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TABLE_SESSION_STALE' THEN RAISE; END IF; END;
 RESET ROLE;
 SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a),'requests',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.request_id) FROM public.dealer_swing_operator_requests a),'voice',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.tracker_voice_events a))::text) INTO after_state;
 IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'replay_conflict_or_stale_assignment_wrote_state'; END IF;
 IF current_database()='vinpoker_voice_swing73_pending_20261014' THEN
  SELECT id INTO STRICT pending_id FROM floor_private.table_mode_requests_v1 WHERE table_session_id=prior.table_session_id AND status='pending';
  SELECT control_epoch,revision INTO STRICT initial_epoch,initial_revision FROM public.table_sessions WHERE id=prior.table_session_id;
  PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
  PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  result:=public.floor_cancel_table_control_mode_request_v1('84000000-0000-4000-8000-000000000001',prior.table_session_id,pending_id);
  RESET ROLE;
  IF result->>'outcome' IS DISTINCT FROM 'cancelled'
  OR NOT EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 WHERE id=pending_id AND status='cancelled')
  OR NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=prior.table_session_id AND control_mode='tracker' AND control_epoch=initial_epoch AND revision=initial_revision AND closed_at IS NULL) THEN RAISE EXCEPTION 'canonical_cancel_changed_mode_or_epoch'; END IF;
  RAISE NOTICE 'SWING73_CANONICAL_PENDING_CANCEL_MODE_EPOCH_PRESERVED_PASS';
 END IF;
 RAISE NOTICE 'VOICE_SWING73_REPLAY_CONFLICT_STALE_ASSIGNMENT_ZERO_WRITE_PASS';
END;
$test$;
ROLLBACK;
