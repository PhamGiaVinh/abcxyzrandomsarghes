\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='12s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid());
 ASSERT md5(replace(pg_get_functiondef('public.operator_check_in_dealers(uuid,uuid,jsonb)'::regprocedure),chr(13),''))='4a7189e6f62f8408c456aeca110035ef';
END $$;
CREATE TEMP TABLE choice260 AS SELECT gen_random_uuid() actor,gen_random_uuid() outsider,gen_random_uuid() club,
 gen_random_uuid() dealer,gen_random_uuid() other_dealer,gen_random_uuid() first_shift,gen_random_uuid() chosen_shift,
 gen_random_uuid() wrong_shift,gen_random_uuid() request,gen_random_uuid() item;
INSERT INTO auth.users(id) SELECT actor FROM choice260 UNION ALL SELECT outsider FROM choice260;
INSERT INTO public.clubs(id,owner_id,name,region,status) SELECT club,actor,'Choice260 rollback TEST','TEST','approved' FROM choice260;
INSERT INTO public.dealers(id,club_id,full_name,status)
 SELECT dealer,club,'Choice260 selected TEST','active' FROM choice260 UNION ALL
 SELECT other_dealer,club,'Choice260 mismatch TEST','active' FROM choice260;
INSERT INTO public.dealer_shifts(club_id,tour_name,start_time,end_time)
 SELECT club,'Choice260 unique legacy shift TEST','00:00','23:59' FROM choice260;
INSERT INTO public.dealer_shift_assignments(id,club_id,dealer_id,work_date,scheduled_start_at,scheduled_end_at,status)
 SELECT first_shift,club,dealer,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,now()-interval '10 minutes',now()+interval '7 hours','cancelled' FROM choice260 UNION ALL
 SELECT chosen_shift,club,dealer,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,now()-interval '5 minutes',now()+interval '8 hours','confirmed' FROM choice260 UNION ALL
 SELECT wrong_shift,club,other_dealer,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,now()-interval '5 minutes',now()+interval '8 hours','confirmed' FROM choice260;
INSERT INTO public.dealer_selfcheckin_config(id,scheduled_pool_enabled) VALUES(true,true)
 ON CONFLICT(id) DO UPDATE SET scheduled_pool_enabled=true;
INSERT INTO public.dealer_swing_phone_rollout(id,enabled,all_clubs_enabled,allowed_club_ids)
 SELECT true,true,false,ARRAY[club] FROM choice260 ON CONFLICT(id) DO UPDATE
 SET enabled=true,all_clubs_enabled=false,allowed_club_ids=excluded.allowed_club_ids;
ALTER TABLE choice260 ADD payload jsonb;
UPDATE choice260 SET payload=jsonb_build_array(jsonb_build_object('entry_id',item,'mode','scheduled','input_method','manual_list',
 'user_id',NULL,'dealer_id',dealer,'shift_assignment_id',chosen_shift,'reason',NULL));
CREATE TEMP TABLE result260(label text PRIMARY KEY,value jsonb);
GRANT SELECT ON choice260 TO authenticated;
GRANT SELECT,INSERT ON result260 TO authenticated;
SELECT set_config('request.jwt.claim.sub',actor::text,true),set_config('request.jwt.claim.role','authenticated',true),
 set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) FROM choice260;
SET LOCAL ROLE authenticated;
INSERT INTO result260 SELECT 'cancelled',public.operator_check_in_dealers(gen_random_uuid(),club,
 jsonb_set(payload,'{0,shift_assignment_id}',to_jsonb(first_shift))) FROM choice260;
INSERT INTO result260 SELECT 'wrong_dealer',public.operator_check_in_dealers(gen_random_uuid(),club,
 jsonb_set(payload,'{0,shift_assignment_id}',to_jsonb(wrong_shift))) FROM choice260;
INSERT INTO result260 SELECT 'selected',public.operator_check_in_dealers(request,club,payload) FROM choice260;
INSERT INTO result260 SELECT 'replay',public.operator_check_in_dealers(request,club,payload) FROM choice260;
INSERT INTO result260 SELECT 'changed',public.operator_check_in_dealers(request,club,
 jsonb_set(payload,'{0,shift_assignment_id}',to_jsonb(first_shift))) FROM choice260;
RESET ROLE;
DO $$ DECLARE f record; r jsonb; BEGIN
 SELECT * INTO f FROM choice260;
 SELECT value INTO r FROM result260 WHERE label='wrong_dealer';
 ASSERT r->'results'->0->>'code'='shift_dealer_mismatch',r::text;
 ASSERT (SELECT value->'results'->0->>'code' FROM result260 WHERE label='cancelled')='invalid_shift_state';
 SELECT value INTO r FROM result260 WHERE label='selected';
 ASSERT r->>'outcome'='completed' AND r->'results'->0->>'code'='checked_in_available',r::text;
 ASSERT r=(SELECT value FROM result260 WHERE label='replay');
 ASSERT (SELECT value->>'outcome' FROM result260 WHERE label='changed')='idempotency_conflict';
 ASSERT (SELECT status FROM public.dealer_shift_assignments WHERE id=f.first_shift)='cancelled';
 ASSERT (SELECT checked_in_at FROM public.dealer_shift_assignments WHERE id=f.first_shift) IS NULL;
 ASSERT (SELECT status FROM public.dealer_shift_assignments WHERE id=f.chosen_shift)='checked_in';
 ASSERT (SELECT count(*) FROM public.dealer_shift_events WHERE assignment_id=f.chosen_shift AND event_type='checked_in')=1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_shift_events WHERE assignment_id IN(f.first_shift,f.wrong_shift));
 ASSERT (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id=f.dealer AND status='checked_in')=1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE dealer_id=f.other_dealer);
 ASSERT (SELECT count(*) FROM public.operator_dealer_checkin_requests WHERE request_id=f.request)=1;
 RAISE NOTICE 'CHOICE260_ACTUAL_AUTHENTICATED_SECOND_SHIFT_ONLY_REPLAY_CONFLICT_PASS';
END $$;
SELECT set_config('request.jwt.claim.sub',outsider::text,true),
 set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) FROM choice260;
SET LOCAL ROLE authenticated;
INSERT INTO result260 SELECT 'outsider',public.operator_check_in_dealers(gen_random_uuid(),club,payload) FROM choice260;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT value->>'reason' FROM result260 WHERE label='outsider')='actor_not_allowed';
 RAISE NOTICE 'CHOICE260_OUTSIDER_DENIED_NO_POLICY_CHANGE_PASS';
END $$;
ROLLBACK;
