-- Canonical whole-hand report -> mode request blocked -> cancel preserves alert.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE result jsonb; hand_revision bigint; initial_revision bigint; initial_epoch bigint; pending_id uuid; alert_id uuid;
BEGIN
 IF current_database()<>'vinpoker_voice_swing73_pending_20261014'
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.report_tracker_wrong_hand_v1(uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),''))<>'716a76ffddf43534ba28c69ea149393b' THEN RAISE EXCEPTION 'owned73_correction_fixture_required'; END IF;
 SELECT source_revision INTO STRICT hand_revision FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
 SELECT revision,control_epoch INTO STRICT initial_revision,initial_epoch FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001';
 INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled)
 VALUES('81000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','81300000-0000-4000-8000-000000000001','report_wrong_action',true);
 PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 result:=public.report_tracker_wrong_hand_v1('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001',hand_revision,'89000000-0000-4000-8000-000000000078');
 IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'alert_id' IS NULL THEN RAISE EXCEPTION 'canonical_whole_hand_report_failed: %',result; END IF;
 alert_id:=(result->>'alert_id')::uuid;
 result:=public.floor_request_table_control_mode_v4('84000000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001','manual',initial_revision,initial_epoch,'89000000-0000-4000-8000-000000000079');
 IF result->>'outcome' IS DISTINCT FROM 'pending' OR NOT (result->'blockers' ? 'correction_pending') THEN RAISE EXCEPTION 'correction_mode_blocker_missing: %',result; END IF;
 pending_id:=(result->>'request_id')::uuid;
 result:=public.floor_cancel_table_control_mode_request_v1('84000000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001',pending_id);
 IF result->>'outcome' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'correction_mode_cancel_failed'; END IF;
 RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM public.tracker_floor_alerts WHERE id=alert_id AND correction_required AND status='open')
 OR NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001' AND control_mode='tracker' AND control_epoch=initial_epoch AND revision=initial_revision AND closed_at IS NULL) THEN RAISE EXCEPTION 'mode_cancel_erased_correction_or_changed_epoch'; END IF;
 RAISE NOTICE 'SWING73_CANONICAL_REPORT_MODE_BLOCKER_CANCEL_PRESERVES_CORRECTION_PASS';
END;
$test$;
ROLLBACK;
