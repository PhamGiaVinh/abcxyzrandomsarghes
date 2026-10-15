\set ON_ERROR_STOP on
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
