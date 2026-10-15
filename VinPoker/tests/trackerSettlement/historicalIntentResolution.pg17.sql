\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_history99_ci','vinpoker_ops_history99_rollback','vinpoker_ops_history99_qualified') OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
 RAISE EXCEPTION 'isolated_history99_fixture_required'; END IF;
END $$;
CREATE TEMP TABLE resolution_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.tournament_hands h) hands,
 (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.tournament_settlement_outcomes o) outcomes,
 (SELECT jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision) FROM public.tracker_historical_display_queue q) queue;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('test.history99_revision',source_revision::text,true) FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ DECLARE rev bigint; answer jsonb; BEGIN
 rev:=current_setting('test.history99_revision')::bigint;
 IF rev<=1 THEN RAISE EXCEPTION 'history99_fixture_needs_multiple_revisions'; END IF;
 answer:=public.resolve_tracker_historical_display_intent_v1('86000000-0000-4000-8000-000000000001',
 '85000000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001',
 'history99-never-committed-key',rev,repeat('a',64),repeat('b',64));
 IF answer->>'status'<>'receipt_not_found' OR answer->'receipt'<>'null'::jsonb THEN RAISE EXCEPTION 'same_revision_not_terminal'; END IF;
 answer:=public.resolve_tracker_historical_display_intent_v1('86000000-0000-4000-8000-000000000001',
 '85000000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001',
 'history99-never-committed-key',rev-1,repeat('a',64),repeat('b',64));
 IF answer->>'status'<>'intent_obsolete' OR (answer->>'current_source_revision')::bigint<>rev
 OR (answer->>'source_revision')::bigint<>rev-1 OR answer->'receipt'<>'null'::jsonb THEN RAISE EXCEPTION 'stale_revision_not_resolved'; END IF;
 -- The real writer must reject this obsolete intent before any outcome write.
 BEGIN
  PERFORM public.commit_tracker_historical_display_outcome_v2('86000000-0000-4000-8000-000000000001',
  '81100000-0000-4000-8000-000000000001','owner_admin',rev-1,repeat('a',64),repeat('b',64),repeat('c',64),
  'history99-never-committed-key','{}'::jsonb,NULL);
  RAISE EXCEPTION 'obsolete_intent_committed';
 EXCEPTION WHEN serialization_failure THEN
  IF SQLERRM<>'stale_source_revision' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.resolve_tracker_historical_display_intent_v1('86000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001','81200000-0000-4000-8000-000000000001',
  'history99-never-committed-key',rev-1,repeat('a',64),repeat('b',64));
  RAISE EXCEPTION 'unauthorized_actor_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text)','EXECUTE') THEN
 RAISE EXCEPTION 'history99_acl_wrong'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.resolve_tracker_historical_display_intent_v1('86000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001',
  'history99-never-committed-key',1,repeat('a',64),repeat('b',64));
  RAISE EXCEPTION 'non_service_claim_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
 IF (SELECT hands FROM resolution_before) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.tournament_hands h)
 OR (SELECT outcomes FROM resolution_before) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.tournament_settlement_outcomes o)
 OR (SELECT queue FROM resolution_before) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(q) ORDER BY q.hand_id,q.source_revision) FROM public.tracker_historical_display_queue q) THEN
 RAISE EXCEPTION 'resolution_mutated_operational_state'; END IF;
END $$;
-- Synthetic immutable receipt fixture tests reader priority, not poker
-- verification or acceptance of this public_outcome by the writer RPC.
SAVEPOINT receipt_fixture;
INSERT INTO public.tournament_settlement_outcomes(tournament_id,hand_id,source_revision,source_chain_hash,
 settlement_revision,outcome_hash,public_outcome,request_hash,idempotency_key,actor_user_id,actor_kind,verification_scope)
 SELECT tournament_id,id,source_revision-1,repeat('a',64),987655,repeat('b',64),'{}'::jsonb,repeat('c',64),
 'history99-prior-committed-key','81100000-0000-4000-8000-000000000001','owner_admin','historical_display'
 FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE answer jsonb; BEGIN
 answer:=public.resolve_tracker_historical_display_intent_v1('86000000-0000-4000-8000-000000000001',
 '85000000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001',
 'history99-prior-committed-key',current_setting('test.history99_revision')::bigint-1,repeat('a',64),repeat('b',64));
 IF answer->>'status'<>'receipt_found' OR answer->'receipt'->>'idempotent'<>'true' THEN RAISE EXCEPTION 'past_receipt_lost_to_obsolete'; END IF;
 BEGIN
  PERFORM public.resolve_tracker_historical_display_intent_v1('86000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001',
  'history99-prior-committed-key',current_setting('test.history99_revision')::bigint-1,repeat('d',64),repeat('b',64));
  RAISE EXCEPTION 'conflicting_payload_resolved';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>'idempotency_mismatch' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK TO receipt_fixture;
ROLLBACK;
\echo HISTORY99_RESOLUTION_STATIC_PASS
