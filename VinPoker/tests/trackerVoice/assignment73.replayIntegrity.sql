-- Follow successful qualified Voice-first overlap; all operations roll back.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE prior public.dealer_swing_operator_requests%ROWTYPE; result jsonb; before_state text; after_state text;
BEGIN
 IF current_database() NOT IN ('vinpoker_voice_swing73_voice_first_qualified_20261014','vinpoker_voice_swing73_pending_20261014')
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'a25a91e02d6f2c0399e5aba1086e4acf' THEN RAISE EXCEPTION 'owned_qualified73_replay_required'; END IF;
 SELECT * INTO STRICT prior FROM public.dealer_swing_operator_requests WHERE request_id='89000000-0000-4000-8000-000000000073';
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
 SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a),'requests',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.request_id) FROM public.dealer_swing_operator_requests a),'voice',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.tracker_voice_events a))::text) INTO after_state;
 IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'replay_conflict_or_stale_assignment_wrote_state'; END IF;
 RAISE NOTICE 'VOICE_SWING73_REPLAY_CONFLICT_STALE_ASSIGNMENT_ZERO_WRITE_PASS';
END;
$test$;
ROLLBACK;
