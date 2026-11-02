-- Exact local operator retry AFTER fixing the verifier. Preserve the original
-- terminal error in audit; never reset attempts, revise a hand or delete proof.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$
DECLARE q public.tracker_historical_display_queue%ROWTYPE; h public.tournament_hands%ROWTYPE;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR current_user<>'postgres'
  OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
  OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
  OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'local_history_retry_target_denied';END IF;
 SELECT * INTO STRICT h FROM public.tournament_hands WHERE id='d96a3776-ebdc-41ff-8c40-1566f4a4599c' FOR UPDATE;
 IF h.tournament_id<>'b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f' OR h.source_revision<>39
  OR h.status<>'completed' OR h.is_voided OR h.button_seat<>4 THEN RAISE EXCEPTION 'local_history_retry_source_drift';END IF;
 IF EXISTS(SELECT 1 FROM public.audit_logs WHERE action='local_history_dead_button_retry'
  AND entity_id=h.id AND payload->>'repair_key'='single-day-hand4-validator-dead-button') THEN
  RAISE NOTICE 'LOCAL_HISTORY_RETRY_ALREADY_AUDITED_NO_MUTATION';RETURN;END IF;
 SELECT * INTO STRICT q FROM public.tracker_historical_display_queue WHERE hand_id=h.id AND source_revision=h.source_revision FOR UPDATE;
 IF q.status<>'needs_attention' OR q.last_error_code<>'historical_contract_invalid:BUTTON_NOT_SEATED'
  OR q.lease_token IS NOT NULL OR EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id=h.id)
  THEN RAISE EXCEPTION 'local_history_retry_not_exact_failed_job';END IF;
 INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
 VALUES('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','065801a0-565e-4bd6-9c2d-ee252b7e6494',
  'local_history_dead_button_retry','tournament_hand',h.id,jsonb_build_object(
   'repair_key','single-day-hand4-validator-dead-button','local_only',true,'before_queue',to_jsonb(q),
   'reason','Verifier now accepts recorded physical dead button; retry same revision, preserve attempts and all source evidence'));
 UPDATE public.tracker_historical_display_queue SET status='pending',next_attempt_at=now(),updated_at=now()
  WHERE hand_id=h.id AND source_revision=h.source_revision;
 RAISE NOTICE 'LOCAL_HISTORY_DEAD_BUTTON_EXACT_RETRY_AUDITED_PASS';
END $$;
COMMIT;
