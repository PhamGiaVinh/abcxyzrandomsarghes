-- Exact linked local journey. Negative probes roll back, including audits.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 WHERE flight_tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee'
  AND end_request_id='c7afef18-7e64-475f-a9a3-f7db20552393' AND status='bagging' AND roster_count=8);
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.start_tracker_hand_v3(p_tournament_id:='fdf91018-09f3-4cdc-b76a-f688eb216cee',
   p_tournament_table_id:='8ce69933-b2d0-4dfe-962e-86709c6222ac',p_table_session_id:='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',
   p_control_epoch:=2,p_hand_number:=2,p_hand_time:=now(),p_created_by:='675fe35e-60a8-4452-bb90-e79486d54da6',p_button_seat:=2);
  RAISE EXCEPTION 'expected_frozen_start_denial';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_end_play_source_frozen',SQLERRM;
 END;
 BEGIN
  PERFORM public.multi_day_end_flight_v1('fdf91018-09f3-4cdc-b76a-f688eb216cee',2,'c7afef18-7e64-475f-a9a3-f7db20552393');
  RAISE EXCEPTION 'expected_same_key_day_conflict';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='multi_day_end_flight_request_conflict',SQLERRM;
 END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='3add8ca8-34ff-4f52-8b40-a48c192d3aa5';
SET LOCAL request.jwt.claims='{"sub":"3add8ca8-34ff-4f52-8b40-a48c192d3aa5","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.multi_day_end_flight_v1('fdf91018-09f3-4cdc-b76a-f688eb216cee',1,'c7afef18-7e64-475f-a9a3-f7db20552393');
  RAISE EXCEPTION 'expected_outsider_denial';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_end_flight_actor_not_allowed',SQLERRM;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.tournament_hands WHERE tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee')=1;
 ASSERT (SELECT sum(tracked_stack) FROM public.multi_day_flight_roster_v1 WHERE flight_tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee')=160000;
 ASSERT (SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='fdf91018-09f3-4cdc-b76a-f688eb216cee')=920000;
END $$;
SELECT 'LOCAL_END174_FREEZE_CONFLICT_OUTSIDER_NO_DELTA_PASS';
ROLLBACK;
