-- Owned reviewed-schema TEST only. Requires main13/27/28 and candidates113/189/301.
-- Uses baseline cash-buyin RPC; no constructor91, cash-intent112 or compatibility298.
-- Direct INSERTs only seed synthetic fixture; operational seating/start/action use real RPCs.
-- Inert repo network support is required; never install network extensions to run this.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='20s';
DO $$ DECLARE
 actor uuid:=gen_random_uuid();club uuid:=gen_random_uuid();
 tour uuid;physical uuid;tt uuid;sess uuid;epoch bigint;hand uuid;button integer;seats integer[];
 player uuid;reg jsonb;r jsonb;first jsonb;replay jsonb;revision bigint;i integer;key text:=gen_random_uuid()::text;
 actors uuid[];entries integer[];
BEGIN
 ASSERT current_database()='vinpoker_ops_guard_main_20261028_v2';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55442;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-main-guards-20261028/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OPS_GUARD_MAIN_20261028_REVIEWED_SCHEMA_ONLY';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 INSERT INTO auth.users(id)VALUES(actor);
 INSERT INTO public.clubs(id,name,region,owner_id,status)VALUES(club,'Reviewed guard TEST','TEST',actor,'approved');
 INSERT INTO public.club_cashiers(club_id,user_id)VALUES(club,actor);
 INSERT INTO public.cashier_tour_settings(club_id,enabled)VALUES(club,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 PERFORM set_config('role','none',true);
 tour:=gen_random_uuid();
 INSERT INTO public.tournaments(id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,starting_stack,current_level,live_status)
 VALUES(tour,club,'Reviewed guard native TEST','active',clock_timestamp(),100000,0,0,20000,1,'registering');
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
 VALUES(tour,1,100,200,0,20,false);
 UPDATE public.game_tables SET table_number=1,operational_status='available' WHERE id=(SELECT id FROM public.game_tables WHERE club_id=club ORDER BY table_name,id LIMIT 1);
 PERFORM set_config('role','none',true);
 SELECT gt.id INTO STRICT physical FROM public.game_tables gt
 WHERE gt.club_id=club AND gt.status='inactive' AND gt.operational_status='available'
   AND NOT EXISTS (SELECT 1 FROM public.table_sessions ts WHERE ts.game_table_id=gt.id AND ts.closed_at IS NULL)
 ORDER BY gt.table_number,gt.id LIMIT 1 FOR UPDATE OF gt SKIP LOCKED;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_open_tournament_table_v3(tour,physical,'tracker',gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 r:=public.cashier_open_shift_v1(club,0);ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 SELECT id,table_session_id INTO STRICT tt,sess FROM public.tournament_tables WHERE tournament_id=tour AND game_table_id=physical;
 FOR i IN 1..3 LOOP
  player:=gen_random_uuid();INSERT INTO auth.users(id)VALUES(player);INSERT INTO public.profiles(user_id,display_name)VALUES(player,'D301 TEST '||player);
  PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
  reg:=public.cashier_create_app_registration_v1(tour,player);ASSERT reg->>'ok'='true',reg::text;
  PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);PERFORM set_config('role','authenticated',true);
  r:=public.cashier_record_cash_buyin_v1((reg->>'registration_id')::uuid,100000,gen_random_uuid());ASSERT r->>'ok'='true',r::text;ASSERT r->>'seating_state'='seated',r::text;
  PERFORM set_config('role','none',true);
 END LOOP;
 SELECT control_epoch INTO STRICT epoch FROM public.table_sessions WHERE id=sess;
 SELECT min(seat_number) INTO button FROM public.tournament_seats WHERE tournament_id=tour AND is_active;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_start_tournament_clock(tour);ASSERT r->>'ok'='true',r::text;
 r:=public.start_tracker_hand_v3(tour,tt,sess,epoch,1,clock_timestamp(),actor,button);ASSERT r->>'status'='success',r::text;hand:=(r->>'hand_id')::uuid;
 r:=public.heartbeat_lock(hand,actor);ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);
 SELECT array_agg(player_id ORDER BY CASE WHEN seat_number>button THEN 0 ELSE 1 END,seat_number),array_agg(entry_number ORDER BY CASE WHEN seat_number>button THEN 0 ELSE 1 END,seat_number)
 INTO actors,entries FROM public.hand_players WHERE hand_id=hand;
 ASSERT array_length(actors,1)=3;
 PERFORM set_config('role','authenticated',true);
 r:=public.record_action(hand,actors[1],'post_sb',1,entries[1],'preflop',100);ASSERT r->>'status'='success',r::text;
 r:=public.record_action(hand,actors[2],'post_bb',2,entries[2],'preflop',200);ASSERT r->>'status'='success',r::text;
 -- Qualify stack189 through the real RPC before the hand becomes decided.
 r:=public.record_action(hand,actors[3],'bet',3,entries[3],'preflop',-1);
 ASSERT r->>'error'='tracker_action_negative_amount','negative amount accepted: '||r::text;
 r:=public.record_action(hand,actors[3],'bet',3,entries[3],'preflop',20001);
 ASSERT r->>'error'='tracker_action_stack_exceeded','over-stack amount accepted: '||r::text;
 r:=public.record_action(hand,actors[1],'bet',3,entries[1],'flop',19901);
 ASSERT r->>'error'='tracker_action_stack_exceeded','cross-round committed budget ignored: '||r::text;
 -- The exact remaining budget is valid; roll only this probe back immediately.
 BEGIN
  r:=public.record_action(hand,actors[1],'bet',3,entries[1],'flop',19900);
  ASSERT r->>'status'='success','exact remaining stack rejected: '||r::text;
  RAISE EXCEPTION USING ERRCODE='P1890',MESSAGE='rollback_exact_budget_probe';
 EXCEPTION WHEN SQLSTATE 'P1890' THEN NULL;
 END;
 PERFORM set_config('role','none',true);
 -- Privileged maintenance also cannot silently bypass the table-level bound.
 BEGIN
  UPDATE public.hand_actions SET action_amount=20001 WHERE hand_id=hand AND action_order=1;
  RAISE EXCEPTION 'direct_update_over_stack_accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tracker_action_stack_exceeded',SQLERRM;
 END;
 BEGIN
  UPDATE public.hand_actions SET entry_number=entries[1]+100 WHERE hand_id=hand AND action_order=1;
  RAISE EXCEPTION 'missing_frozen_entry_evidence_accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tracker_action_stack_evidence_missing',SQLERRM;
 END;
 BEGIN
  UPDATE public.hand_actions SET hand_id=gen_random_uuid() WHERE hand_id=hand AND action_order=1;
  RAISE EXCEPTION 'reparent_to_missing_hand_accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tracker_action_stack_evidence_missing',SQLERRM;
 END;
 ASSERT (SELECT count(*)=2 AND sum(action_amount)=300 FROM public.hand_actions WHERE hand_id=hand);
 PERFORM set_config('role','authenticated',true);
 r:=public.record_action(hand,actors[3],'fold',3,entries[3],'preflop',0);ASSERT r->>'status'='success',r::text;
 first:=public.record_action(hand,actors[1],'fold',4,entries[1],'preflop',0,key);ASSERT first->>'status'='success',first::text;
 PERFORM set_config('role','none',true);SELECT source_revision INTO revision FROM public.tournament_hands WHERE id=hand;
 PERFORM set_config('role','authenticated',true);
 r:=public.record_action(hand,actors[2],'fold',5,entries[2],'preflop',0);
 ASSERT r->>'error'='tracker_hand_already_decided','last survivor fold accepted: '||r::text;
 replay:=public.record_action(hand,actors[1],'fold',4,entries[1],'preflop',0,key);
 ASSERT replay->>'status'='success' AND replay->>'duplicate'='true' AND replay->>'action_id'=first->>'action_id','confirmed replay changed: '||replay::text;
 r:=public.record_action(hand,actors[2],'check',5,entries[2],'preflop',0);
 ASSERT r->>'error'='tracker_hand_already_decided','new action after fold win accepted: '||r::text;
 PERFORM set_config('request.jwt.claim.sub',actors[3]::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actors[3])::text,true);
 r:=public.record_action(hand,actors[1],'fold',4,entries[1],'preflop',0,key);
 ASSERT r->>'error'='tracker_lock_owned_by_another','actor/lock guard changed: '||r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT source_revision=revision FROM public.tournament_hands WHERE id=hand);
 ASSERT (SELECT count(*)=4 AND count(*)FILTER(WHERE action_type='fold')=2 FROM public.hand_actions WHERE hand_id=hand);
 ASSERT (SELECT count(*)=3 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id=tour AND is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id=hand);
END $$;
ROLLBACK;
SELECT 'DECIDED_HAND_LAST_SURVIVOR_REJECT_REPLAY_AND_LOCK_GUARDS_PASS';
