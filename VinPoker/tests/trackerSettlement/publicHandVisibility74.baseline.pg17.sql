-- Reproduce raw-read bypass before74 on the owned qualified CI clone.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE n integer;
BEGIN
 IF current_database() NOT IN ('vinpoker_visibility74_ci','vinpoker_visibility74_baseline_20261014') OR current_user<>'postgres'
 OR inet_server_addr()<>'127.0.0.1'::inet
 OR (current_database()='vinpoker_visibility74_ci' AND inet_server_port()<>55441)
 OR (current_database()='vinpoker_visibility74_baseline_20261014' AND inet_server_port()<>55464)
 OR to_regprocedure('floor_private.tracker_hand_read_scope74(uuid,boolean,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'owned_pre74_fixture_required'; END IF;
 UPDATE public.tournaments SET deleted_at=now() WHERE id='85000000-0000-4000-8000-000000000001';
 INSERT INTO public.hand_actions(hand_id,player_id,entry_number,action_type,action_amount,action_order)
 SELECT hand_id,player_id,entry_number,'fold',0,740074 FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001' ORDER BY seat_number LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 SET LOCAL ROLE anon;
 SELECT count(*) INTO n FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001';
 IF n<>1 THEN RAISE EXCEPTION 'pre74_raw_bypass_not_reproduced'; END IF;
 SELECT count(*) INTO n FROM public.hand_actions WHERE hand_id='86000000-0000-4000-8000-000000000001';
 IF n<>1 THEN RAISE EXCEPTION 'pre74_raw_action_bypass_not_reproduced'; END IF;
 RESET ROLE;
 RAISE NOTICE 'VISIBILITY74_PRECHANGE_RAW_DELETED_HAND_BYPASS_REPRODUCED';
END;
$test$;
ROLLBACK;
