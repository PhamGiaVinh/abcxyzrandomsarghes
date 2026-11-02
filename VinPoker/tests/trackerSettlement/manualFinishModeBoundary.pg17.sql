\set ON_ERROR_STOP on
\if :{?CORRECTION_CASE}
\else
\set CORRECTION_CASE false
\endif
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_history98_rollback','vinpoker_ops_history98_ci') OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
 RAISE EXCEPTION 'isolated_finish_mode_fixture_required'; END IF;
END $$;
UPDATE public.tournament_hands SET status='in_progress',is_voided=false,
 locked_by_user_id='81400000-0000-4000-8000-000000000001',locked_at=now()
 WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE finish_mode_before AS SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) AS seats
 FROM public.tournament_seats s WHERE s.table_session_id='83500000-0000-4000-8000-000000000001';
CREATE TEMP TABLE finish_mode_intent AS
 SELECT jsonb_build_object('actor_id','81400000-0000-4000-8000-000000000001','request_id',gen_random_uuid(),
 'tournament_id',h.tournament_id,'tournament_table_id',h.tournament_table_id,'hand_id',h.id,
 'table_session_id',h.table_session_id,'control_epoch',s.control_epoch,'source_revision',h.source_revision,
 'payload',jsonb_build_object('hand_time',now(),'players',(SELECT jsonb_agg(jsonb_build_object(
 'player_id',p.player_id,'entry_number',p.entry_number,'seat_number',p.seat_number,'starting_stack',p.starting_stack,
 'ending_stack',p.starting_stack,'is_eliminated',false,'hole_cards','[]'::jsonb)) FROM public.hand_players p WHERE p.hand_id=h.id),
 'actions','[]'::jsonb,'side_pots','[]'::jsonb,'community_cards','[]'::jsonb,'pot_size',0)) AS intent
 FROM public.tournament_hands h JOIN public.table_sessions s ON s.id=h.table_session_id
 WHERE h.id='86000000-0000-4000-8000-000000000001';
\if :CORRECTION_CASE
INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled)
 VALUES('81000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',
 '84000000-0000-4000-8000-000000000001','81300000-0000-4000-8000-000000000001','report_wrong_action',true);
SELECT set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81300000-0000-4000-8000-000000000001"}',true);
CREATE TEMP TABLE finish_mode_correction(alert_id uuid);
DO $$ DECLARE intent jsonb; result jsonb; BEGIN
 SELECT i.intent INTO STRICT intent FROM finish_mode_intent i;
 PERFORM set_config('role','authenticated',true);
 result:=public.report_tracker_wrong_hand_v1((intent->>'tournament_id')::uuid,(intent->>'tournament_table_id')::uuid,
 (intent->>'hand_id')::uuid,(intent->>'source_revision')::bigint,gen_random_uuid());
 PERFORM set_config('role','none',true);
 IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'alert_id' IS NULL THEN RAISE EXCEPTION 'mode_report_failed: %',result; END IF;
 INSERT INTO finish_mode_correction VALUES((result->>'alert_id')::uuid);
END $$;
\endif
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81100000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE result jsonb; session public.table_sessions%ROWTYPE; BEGIN
 SELECT * INTO STRICT session FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001';
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_request_table_control_mode_v4('84000000-0000-4000-8000-000000000001',session.id,'manual',
 session.revision,session.control_epoch,gen_random_uuid());
 PERFORM set_config('role','none',true);
 IF result->>'outcome' IS DISTINCT FROM 'pending' OR NOT(result->'blockers' ? 'active_hand')
 THEN RAISE EXCEPTION 'finish_mode_request_not_queued: %',result; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
\if :CORRECTION_CASE
DO $$ DECLARE intent jsonb; result jsonb; before_hand jsonb; before_state jsonb; after_state jsonb;
 snapshot_sql text:=$snapshot$SELECT jsonb_build_object(
 'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.player_id,x.entry_number) FROM public.hand_players x),
 'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.hand_actions x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_seats x),
 'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_entries x),
 'chips',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tournament_id,x.player_id,x.entry_number) FROM public.tournament_chip_counts x),
 'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.source_revision) FROM public.tracker_historical_display_queue x),
 'outcomes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_settlement_outcomes x),
 'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.actor_id,x.operation_type,x.request_id) FROM public.table_operation_receipts x))$snapshot$;
BEGIN
 SELECT i.intent INTO STRICT intent FROM finish_mode_intent i;
 SELECT to_jsonb(h) INTO before_hand FROM public.tournament_hands h WHERE h.id=(intent->>'hand_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 WHERE table_session_id=(intent->>'table_session_id')::uuid
 AND status='pending' AND blockers ? 'correction_pending') THEN RAISE EXCEPTION 'mode_correction_blocker_missing'; END IF;
 EXECUTE snapshot_sql INTO before_state;
 PERFORM set_config('role','authenticated',true);
 BEGIN
  result:=public.record_tracker_manual_hand_v1(intent);
  IF result->>'error' IS DISTINCT FROM 'tracker_correction_pending' THEN RAISE EXCEPTION 'correction_finish_not_blocked: %',result; END IF;
  RAISE NOTICE 'CANONICAL_FINISH_CORRECTION_JSONB_OBSERVED';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'tracker_correction_pending' THEN RAISE; END IF;
 RAISE NOTICE 'CANONICAL_FINISH_CORRECTION_P0001_OBSERVED'; END;
 IF public.get_tracker_manual_finish_receipt_v1(intent)->>'error' IS DISTINCT FROM 'receipt_not_found'
 THEN RAISE EXCEPTION 'blocked_finish_left_receipt'; END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE h.id=(intent->>'hand_id')::uuid) IS DISTINCT FROM before_hand
 THEN RAISE EXCEPTION 'blocked_finish_changed_hand'; END IF;
 EXECUTE snapshot_sql INTO after_state;
 IF after_state IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'blocked_finish_left_partial_operational_write'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81300000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE alert public.tracker_floor_alerts%ROWTYPE; result jsonb; BEGIN
 SELECT a.* INTO STRICT alert FROM public.tracker_floor_alerts a JOIN finish_mode_correction c ON c.alert_id=a.id;
 PERFORM set_config('role','authenticated',true);
 result:=public.transition_tracker_floor_alert(alert.id,alert.version,'dismiss','Local TEST false report; preserve audit','mode-test-dismiss-'||gen_random_uuid()::text);
 PERFORM set_config('role','none',true);
 IF result->>'status' IS DISTINCT FROM 'dismissed' THEN RAISE EXCEPTION 'canonical_correction_dismiss_failed: %',result; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001' AND control_mode='tracker')
 THEN RAISE EXCEPTION 'mode_changed_before_active_hand_finished'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
\endif
CREATE TEMP TABLE finish_mode_result(receipt jsonb);
DO $$ DECLARE intent jsonb; receipt jsonb; BEGIN
 SELECT i.intent INTO STRICT intent FROM finish_mode_intent i;
 PERFORM set_config('role','authenticated',true);
 receipt:=public.record_tracker_manual_hand_v1(intent);
 PERFORM set_config('role','none',true);
 INSERT INTO finish_mode_result VALUES(receipt);
END $$;
DO $$ BEGIN
 IF (SELECT receipt->>'status' FROM finish_mode_result) IS DISTINCT FROM 'success'
 THEN RAISE EXCEPTION 'finish_mode_canonical_finish_failed: %',(SELECT receipt FROM finish_mode_result); END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE intent jsonb; receipt jsonb; verdict jsonb; BEGIN
 SELECT i.intent,r.receipt INTO intent,receipt FROM finish_mode_intent i CROSS JOIN finish_mode_result r;
 IF NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001'
 AND control_mode='manual' AND control_epoch=(intent->>'control_epoch')::bigint+1)
 THEN RAISE EXCEPTION 'finish_did_not_apply_queued_mode_without_client'; END IF;
 PERFORM set_config('role','authenticated',true);
 IF public.get_tracker_manual_finish_receipt_v1(intent) IS DISTINCT FROM receipt
 OR public.record_tracker_manual_hand_v1(intent) IS DISTINCT FROM receipt
 THEN RAISE EXCEPTION 'mode_change_lost_original_commit_receipt'; END IF;
 verdict:=public.record_tracker_manual_hand_v1(jsonb_set(intent,'{request_id}',to_jsonb(gen_random_uuid())));
 IF verdict->>'error' IS DISTINCT FROM 'stale_manual_finish_context' THEN RAISE EXCEPTION 'old_epoch_new_request_accepted: %',verdict; END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s
 WHERE s.table_session_id='83500000-0000-4000-8000-000000000001') IS DISTINCT FROM (SELECT seats FROM finish_mode_before)
 THEN RAISE EXCEPTION 'finish_mode_changed_seats_or_chips'; END IF;
END $$;
ROLLBACK;
\echo MANUAL_FINISH_QUEUED_MODE_SERVER_BOUNDARY_RECEIPT_PASS
