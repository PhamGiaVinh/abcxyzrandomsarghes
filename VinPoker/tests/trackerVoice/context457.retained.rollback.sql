BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
CREATE FUNCTION pg_temp.facts457() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealers x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_shifts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tracker_voice_configs x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY key) FROM public.app_settings x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tracker_voice_events x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.audit_logs x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x))::text);
$$;
DO $test$ DECLARE tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';table_id uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';
 session_id uuid:='ee2b9393-0c96-42f9-8667-7f306edeb9bc';actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';dealer uuid:=gen_random_uuid();shift uuid:=gen_random_uuid();attendance uuid:=gen_random_uuid();
 assignment_id uuid;physical uuid;epoch bigint;baseline text;result jsonb;
 hand uuid;player record;state text;command jsonb;receipt jsonb;action_result jsonb;replay jsonb;
 task_key text:='voice458-'||gen_random_uuid()::text;number integer;button integer;
BEGIN
 baseline:=pg_temp.facts457();
 SELECT game_table_id,control_epoch INTO STRICT physical,epoch FROM public.table_sessions WHERE id=session_id AND closed_at IS NULL AND control_mode='tracker';
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id=session_id AND status='assigned' AND released_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_voice_configs WHERE tournament_id=tour AND tournament_table_id=table_id);
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual','x-vinpoker-dealer-actor',actor)::text,true);
  INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(shift,club,'Voice457 transaction TEST','00:00','23:59');
  INSERT INTO public.dealers(id,club_id,full_name,status,user_id) VALUES(dealer,club,'Voice457 Telegram-only TEST','active',NULL);
  INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
   VALUES(attendance,dealer,shift,current_date,'checked_in',now(),'assigned');
  INSERT INTO public.dealer_assignments(table_id,table_session_id,club_id,dealer_id,attendance_id,status,assigned_at)
   VALUES(physical,session_id,club,dealer,attendance,'assigned',now()) RETURNING id INTO assignment_id;
  INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  INSERT INTO public.tracker_voice_configs(club_id,tournament_id,tournament_table_id,physical_table_id,table_session_id,control_epoch,enabled,configured_mode)
   VALUES(club,tour,table_id,physical,session_id,epoch,true,'assist');
  PERFORM set_config('role','authenticated',true);
  result:=public.get_tracker_voice_runtime_context(tour,table_id);
  ASSERT result->'ok'='true'::jsonb AND result->'can_mint_session'='true'::jsonb, result::text;
  PERFORM set_config('role','none',true);
  result:=public._tracker_voice_assignment_context(tour,table_id,'00000000-0000-4000-8000-000000000099');
  ASSERT result->'ok'='false'::jsonb, 'outsider: '||result::text;
  BEGIN
   SELECT COALESCE(max(hand_number),0)+1 INTO number FROM public.tournament_hands WHERE tournament_id=tour;
   SELECT min(seat_number) INTO button FROM public.tournament_seats WHERE table_session_id=session_id AND is_active;
   PERFORM set_config('role','authenticated',true);
   -- Retained tournament already has its clock; do not start it twice.
   result:=public.start_tracker_hand_v3(tour,table_id,session_id,epoch,number,now(),actor,button);
   ASSERT result->>'status'='success', 'start: '||result::text;
   PERFORM set_config('role','none',true);
   SELECT id INTO STRICT hand FROM public.tournament_hands WHERE tournament_id=tour AND status='in_progress';
   SELECT * INTO STRICT player FROM public.hand_players WHERE hand_id=hand AND seat_number=button;
   state:=public._tracker_voice_hand_state_version(hand);
   command:=jsonb_build_object('kind','fold','canonical_action','fold','actor_player_id',player.player_id,
     'entry_number',player.entry_number,'street','preflop','action_order',1,'action_amount',0);
   PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
   PERFORM set_config('role','service_role',true);
   receipt:=public._tracker_voice_register_validated_event(actor,tour,table_id,hand,'openai_realtime',
     'gpt-live-transcribe',task_key,NULL,'fold',command,state,'assist',task_key,'voice458-trace','enforce',true,NULL);
   ASSERT receipt->>'ok'='true', 'register: '||receipt::text;
   PERFORM set_config('role','none',true);
   ASSERT NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id=hand);
   BEGIN
    UPDATE public.dealer_assignments SET released_at=now() WHERE id=assignment_id;
    PERFORM set_config('role','authenticated',true);
    replay:=public.record_action(hand,player.player_id,'fold',1,player.entry_number,'preflop',0,task_key,'voice458-revoked',actor);
    ASSERT replay->>'error'='dealer_assignment_lost', 'revoked commit: '||replay::text;
    PERFORM set_config('role','none',true);
    ASSERT NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id=hand);
    RAISE EXCEPTION USING ERRCODE='P0458',MESSAGE='rollback Voice458 revocation';
   EXCEPTION WHEN SQLSTATE 'P0458' THEN NULL;END;
   PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
   PERFORM set_config('role','authenticated',true);
   action_result:=public.record_action(hand,player.player_id,'fold',1,player.entry_number,'preflop',0,task_key,'voice458-commit',actor);
   ASSERT action_result->>'status'='success' AND action_result->>'source'='voice', 'commit: '||action_result::text;
   replay:=public.record_action(hand,player.player_id,'fold',1,player.entry_number,'preflop',0,task_key,'voice458-retry',actor);
   ASSERT replay->>'status'='success' AND replay->'duplicate'='true'::jsonb
     AND replay->>'action_id'=action_result->>'action_id', 'retry: '||replay::text;
   PERFORM set_config('role','none',true);
   ASSERT (SELECT count(*) FROM public.hand_actions WHERE hand_id=hand)=1;
   ASSERT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id=hand AND source='voice');
   RAISE EXCEPTION USING ERRCODE='P0458',MESSAGE='rollback Voice458 canonical hand/action';
  EXCEPTION WHEN SQLSTATE 'P0458' THEN NULL;END;
  BEGIN
   UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id=session_id;
   result:=public._tracker_voice_assignment_context(tour,table_id,actor);
   -- The installed epoch-sync trigger advances the config and disables it.
   -- Therefore this real table-session update must fail as disabled, not stale.
   ASSERT result->>'error'='voice_config_disabled', 'epoch: '||result::text;
   ASSERT EXISTS(SELECT 1 FROM public.tracker_voice_configs WHERE tournament_id=tour
     AND tournament_table_id=table_id AND control_epoch=epoch+1 AND enabled=false);
   RAISE EXCEPTION USING ERRCODE='P0458',MESSAGE='rollback stale epoch fixture';
  EXCEPTION WHEN SQLSTATE 'P0458' THEN NULL;END;
  ASSERT public._tracker_voice_assignment_context(tour,table_id,actor)->'ok'='true'::jsonb;
  BEGIN
   UPDATE public.dealer_assignments SET released_at=now() WHERE id=assignment_id;
   result:=public._tracker_voice_assignment_context(tour,table_id,actor);
   ASSERT result->>'error'='dealer_assignment_missing', 'release: '||result::text;
   RAISE EXCEPTION USING ERRCODE='P0458',MESSAGE='rollback released assignment fixture';
  EXCEPTION WHEN SQLSTATE 'P0458' THEN NULL;END;
  RAISE EXCEPTION USING ERRCODE='P0457',MESSAGE='rollback complete Voice context fixture';
 EXCEPTION WHEN SQLSTATE 'P0457' THEN NULL;END;
 ASSERT pg_temp.facts457()=baseline;
 RAISE NOTICE 'VOICE457_CONTEXT_AND_VOICE458_CANONICAL_ACTION_REVOKED_RECEIPT_REPLAY_EXACT_ROLLBACK_PASS';
END $test$;
ROLLBACK;
