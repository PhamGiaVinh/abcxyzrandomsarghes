\set ON_ERROR_STOP on
-- Isolated synthetic Tracker/Dealer identity, canonical check-in/assignment/start/
-- action/Undo writers, all rolled back. No retained actor gets new privileges.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='20s';
DO $$ DECLARE
 club uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 owner_actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';
 tbl uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';
 sess uuid:='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
 actor uuid:=gen_random_uuid(); dealer uuid:=gen_random_uuid(); shift uuid:=gen_random_uuid();
 attendance uuid; physical uuid; hand uuid; sb uuid; bb uuid; act uuid;
 rev bigint; key uuid:=gen_random_uuid(); boundary_key uuid:=gen_random_uuid(); answer jsonb; receipt jsonb; proof text;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=owner_actor);
 ASSERT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id=club AND auto_swing_enabled=false);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=tour AND hand_number>=39);
 ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_table_id=tbl AND is_active);
 SELECT game_table_id INTO physical FROM public.table_sessions WHERE id=sess AND club_id=club AND tournament_id=tour
  AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=12;
 ASSERT physical IS NOT NULL;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_id=physical AND released_at IS NULL
  AND status IN('assigned','on_break','pre_assigned','reserved'));
 -- Fixture-only authorization; new identity is removed by outer rollback.
 INSERT INTO auth.users(id) VALUES(actor);
 INSERT INTO public.club_trackers(club_id,user_id,granted_by) VALUES(club,actor,owner_actor);
 INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES(dealer,club,actor,'Undo681 rollback TEST','active');
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(shift,club,'Undo681 rollback TEST','00:00','23:59');
 PERFORM set_config('request.jwt.claim.sub',owner_actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.operator_check_in_dealer_v1(dealer,club,shift,gen_random_uuid());
 ASSERT answer->>'ok'='true' AND answer->>'outcome'='checked_in',answer::text;
 PERFORM set_config('role','none',true);
 SELECT id INTO attendance FROM public.dealer_attendance WHERE dealer_id=dealer AND check_out_time IS NULL;
 ASSERT attendance IS NOT NULL;
 ASSERT floor_private.dealer_pool_attendance_matches_v1(dealer,club,statement_timestamp());
 PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual','x-vinpoker-dealer-actor',owner_actor)::text,true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);
 answer:=public.worker_assign_dealer_to_session_v1(club,physical,sess,attendance,
  statement_timestamp()+interval '45 minutes','undo681:'||key::text);
 ASSERT answer->>'outcome'='ok',answer::text;
 PERFORM set_config('role','none',true);
 INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled,expires_at)
 VALUES(club,tour,tbl,actor,'undo_open_hand',true,statement_timestamp()+interval '10 minutes');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.start_tracker_hand_v3(tour,tbl,sess,12,39,statement_timestamp(),actor,1);
 ASSERT answer->>'status'='success',answer::text; hand:=(answer->>'hand_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT player_id INTO sb FROM public.hand_players WHERE hand_id=hand AND seat_number=1;
 SELECT player_id INTO bb FROM public.hand_players WHERE hand_id=hand AND seat_number=2;
 PERFORM set_config('role','authenticated',true);
 answer:=public.record_action(hand,sb,'post_sb',1,1,'preflop',100,key||':sb',NULL,actor);
 ASSERT answer->>'status'='success',answer::text;
 answer:=public.record_action(hand,bb,'post_bb',2,1,'preflop',200,key||':bb',NULL,actor);
 ASSERT answer->>'status'='success',answer::text;
 answer:=public.record_action(hand,sb,'fold',3,1,'preflop',0,key||':fold',NULL,actor);
 ASSERT answer->>'status'='success',answer::text; act:=(answer->>'action_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT source_revision INTO rev FROM public.tournament_hands WHERE id=hand;
 SELECT source_chain_hash INTO proof FROM public.get_tournament_historical_display_source_hash(hand);
 PERFORM set_config('role','authenticated',true);
 receipt:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev,key);
 ASSERT receipt->>'ok'='true' AND receipt->>'duplicate'='false',receipt::text;
 ASSERT (receipt->>'source_revision')::bigint>rev;
 answer:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev,key);
 ASSERT answer->>'duplicate'='true' AND answer-'duplicate'=receipt-'duplicate',answer::text;
 answer:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev+1,key);
 ASSERT answer->>'error'='request_key_conflict',answer::text;
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,act,rev,key);
 ASSERT answer->>'outcome'='recorded' AND answer->'receipt'->>'duplicate'='true',answer::text;
 PERFORM set_config('role','none',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE id=act);
 ASSERT (SELECT count(*)=2 FROM public.hand_actions WHERE hand_id=hand);
 ASSERT (SELECT count(*)=1 FROM public.tracker_correction_operations WHERE actor_user_id=actor AND idempotency_key=key);
 ASSERT proof IS DISTINCT FROM (SELECT source_chain_hash FROM public.get_tournament_historical_display_source_hash(hand));
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id=hand AND status IN('pending','processing'));
 -- Undo must stop at the blind; denied operation cannot produce a receipt.
 SELECT source_revision INTO rev FROM public.tournament_hands WHERE id=hand;
 SELECT id INTO act FROM public.hand_actions WHERE hand_id=hand AND action_order=2;
 PERFORM set_config('role','authenticated',true);
 answer:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev,boundary_key);
 ASSERT answer->>'error'='undo_boundary_blind',answer::text;
 answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,act,rev,boundary_key);
 ASSERT answer->>'outcome'='not_found',answer::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT source_revision=rev FROM public.tournament_hands WHERE id=hand);
 ASSERT (SELECT count(*)=2 FROM public.hand_actions WHERE hand_id=hand);
 ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_table_id=tbl AND is_active);
END $$;
ROLLBACK;
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number>=39);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealers WHERE full_name='Undo681 rollback TEST');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_shifts WHERE tour_name='Undo681 rollback TEST');
 ASSERT (SELECT count(*)=7 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='592a1d69-3e2c-4a07-aa7a-8a77a7907f5f' AND shift_date='2026-10-20' AND current_state='available' AND check_out_time IS NULL);
END $$;
ROLLBACK;
SELECT 'UNDO681_CANONICAL_CURRENT_CHECKIN_ASSIGN_START_ACTION_UNDO_REPLAY_CONFLICT_ROLLBACK_PASS';
