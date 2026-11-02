\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE owner_id uuid:=gen_random_uuid(); club uuid:=gen_random_uuid(); dealer uuid:=gen_random_uuid();
 assignment uuid:=gen_random_uuid(); result jsonb; first_result jsonb; intent uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); payload jsonb; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 INSERT INTO auth.users(id) VALUES(owner_id);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Pool254 caller TEST','TEST','approved');
 INSERT INTO public.dealers(id,club_id,full_name,status) VALUES(dealer,club,'Pool254 caller TEST','active');
 INSERT INTO public.dealer_shifts(club_id,tour_name,start_time,end_time)
 VALUES(club,'Ambiguous A TEST','08:00','23:00'),(club,'Ambiguous B TEST','12:00','23:00');
 INSERT INTO public.dealer_shift_assignments(id,club_id,dealer_id,work_date,scheduled_start_at,scheduled_end_at,status,checked_in_at)
 VALUES(assignment,club,dealer,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  now()-interval '5 minutes',now()+interval '8 hours','checked_in',now()-interval '1 minute');
 INSERT INTO public.dealer_selfcheckin_config(id,scheduled_pool_enabled) VALUES(true,true)
 ON CONFLICT(id) DO UPDATE SET scheduled_pool_enabled=true;
 result:=public._dealer_record_checkin(assignment,'pool254_local');
 ASSERT result->>'pool_entry_reason'='pool_entry_unverified','ambiguous shift must not report already_in_pool';
 ASSERT (result->>'entered_pool')::boolean=false;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE dealer_id=dealer);
 -- The bridge must not count an unverified entry either.
 PERFORM public.bridge_shift_checkins_to_pool();
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE dealer_id=dealer);
 RAISE NOTICE 'POOL254_CALLER_AMBIGUOUS_NOT_FALSE_SUCCESS_PASS';
 -- Real authenticated phone RPC, no mocked outcome. Rollout changes rollback.
 INSERT INTO public.dealer_swing_phone_rollout(id,enabled,all_clubs_enabled,allowed_club_ids)
 VALUES(true,true,false,ARRAY[club]) ON CONFLICT(id) DO UPDATE
 SET enabled=true,all_clubs_enabled=false,allowed_club_ids=ARRAY[club];
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 payload:=jsonb_build_array(jsonb_build_object('entry_id',item,'mode','scheduled','input_method','manual_list',
  'dealer_id',dealer,'shift_assignment_id',assignment,'user_id',NULL,'reason',NULL));
 result:=public.operator_check_in_dealers(gen_random_uuid(),club,payload);
 ASSERT result->'results'->0->>'code'='failed',result::text;
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE dealer_id=dealer);
 -- Remove only this transaction's redundant shift, then retry as a new resolved intent.
 DELETE FROM public.dealer_shifts WHERE club_id=club AND tour_name='Ambiguous B TEST';
 first_result:=public.operator_check_in_dealers(intent,club,payload);
 ASSERT first_result->'results'->0->>'code'='checked_in_available',first_result::text;
 ASSERT public.operator_check_in_dealers(intent,club,payload)=first_result,'same request must replay unchanged';
 ASSERT (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id=dealer)=1;
 ASSERT (SELECT shift_date FROM public.dealer_attendance WHERE dealer_id=dealer)=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
 ASSERT public.operator_check_in_dealers(intent,club,jsonb_build_array(jsonb_build_object('entry_id',item,
  'mode','unscheduled','input_method','manual_list','dealer_id',dealer,'reason','changed payload',
  'user_id',NULL,'shift_assignment_id',NULL)))->>'outcome'='idempotency_conflict';
 RAISE NOTICE 'POOL254_PHONE_RETRY_ACTUAL_ENTRY_RECEIPT_CONFLICT_PASS';
END $$;
ROLLBACK;
