\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='20s';
DO $$ DECLARE
 actor uuid:='4276983c-90a4-43e5-9e6d-d6f3223d4cd9';club uuid:='de159831-1680-4178-865c-720d47367d43';
 tour uuid;physical uuid;tt uuid;sess uuid;epoch bigint;hand uuid;button integer;seats integer[];
 player uuid;reg jsonb;r jsonb;first jsonb;replay jsonb;revision bigint;i integer;key text:=gen_random_uuid()::text;
 actors uuid[];entries integer[];
BEGIN
 ASSERT current_database()='vinpoker_decided_action_20261028';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_DECIDED_ACTION_20261028_OWNED_LOCAL_TEST';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.create_tournament_with_levels_v1(club,jsonb_build_object('name','Decided action rollback TEST','start_time',clock_timestamp(),'buy_in',100000,'rake_amount',0,'service_fee_amount',0,'starting_stack',20000,'game_type','nlh','minutes_per_level',20,'late_reg_close_level',6),
 '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),actor);
 ASSERT r->>'ok'='true',r::text;tour:=(r->>'tournament_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT gt.id INTO STRICT physical FROM public.game_tables gt
 WHERE gt.club_id=club AND gt.status='inactive' AND gt.operational_status='available'
   AND NOT EXISTS (SELECT 1 FROM public.table_sessions ts WHERE ts.game_table_id=gt.id AND ts.closed_at IS NULL)
 ORDER BY gt.table_number,gt.id LIMIT 1 FOR UPDATE OF gt SKIP LOCKED;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_open_tournament_table_v3(tour,physical,'tracker',gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 PERFORM set_config('role','none',true);
 SELECT id,table_session_id INTO STRICT tt,sess FROM public.tournament_tables WHERE tournament_id=tour AND game_table_id=physical;
 FOR i IN 1..3 LOOP
  player:=gen_random_uuid();INSERT INTO auth.users(id)VALUES(player);INSERT INTO public.profiles(user_id,display_name)VALUES(player,'D301 TEST '||player);
  PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
  reg:=public.cashier_create_app_registration_v1(tour,player);ASSERT reg->>'ok'='true',reg::text;
  PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub',actor::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);PERFORM set_config('role','authenticated',true);
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id',actor,'club_id',club,'tournament_id',tour,'registration_id',reg->>'registration_id','amount',100000,'request_id',gen_random_uuid()),'record');ASSERT r->>'status'='recorded',r::text;
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
