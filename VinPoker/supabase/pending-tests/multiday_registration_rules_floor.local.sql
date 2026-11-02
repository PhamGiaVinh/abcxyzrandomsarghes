-- Run only through the guarded runtime wrapper, inside its outer ROLLBACK.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_main_replay_20261029';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
END $$;
DO $$
DECLARE actor constant uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 club constant uuid:='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 event constant uuid:='650c1ae7-4ed9-4465-a546-5648aabdafb1';
 physical constant uuid:='f7290000-0000-4000-8000-000000000011';
 tour uuid; opened jsonb; result jsonb; replay jsonb; proof jsonb;
 tt uuid; sess uuid; rev bigint; epoch bigint; request uuid:=gen_random_uuid();
 target_event uuid; target_tour uuid; legacy_entry uuid:=gen_random_uuid(); created jsonb;
 outsider uuid;
BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor);
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 WHERE event_id=event);
 SELECT id INTO STRICT tour FROM public.tournaments WHERE event_id=event AND phase='flight' ORDER BY flight_label LIMIT 1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=tour);
 INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
 VALUES(physical,club,'Rules boundary local TEST',98,'tournament','inactive','available');
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY[club] WHERE id;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3(tour,physical,'manual',gen_random_uuid());
 ASSERT opened->>'ok'='true',opened::text;
 tt:=(opened->>'tournament_table_id')::uuid; sess:=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT revision,control_epoch INTO STRICT rev,epoch FROM public.table_sessions WHERE id=sess;
 SELECT u.id INTO STRICT outsider FROM auth.users u
 WHERE u.id<>actor AND NOT floor_private.floor_table_v3_actor_is_tournament_operator(u.id,club)
 ORDER BY u.id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_add_manual_player_v1(tour,'Denied outsider TEST',tt,1,sess,rev,epoch,gen_random_uuid(),outsider);
 ASSERT result->>'error'='actor_not_allowed',result::text;
 result:=public.floor_add_manual_player_v1(tour,'Changed actor TEST',tt,1,sess,rev,epoch,gen_random_uuid(),actor);
 ASSERT result->>'error'='ACTOR_CHANGED',result::text;
 PERFORM set_config('role','none',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=tour);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 BEGIN
  PERFORM public.floor_add_manual_player_v1(tour,'Pre-rules TEST',tt,1,sess,rev,epoch,request,actor);
  RAISE EXCEPTION 'EXPECTED_MANUAL_ENTRY_REJECTION_MISSING';
 EXCEPTION WHEN check_violation THEN
  ASSERT SQLERRM='multi_day_rules_required_before_entry',SQLERRM;
 END;
 PERFORM set_config('role','none',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=tour);
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE actor_id=actor AND request_id=request);
 PERFORM set_config('role','authenticated',true);
 result:=public.multi_day_set_qualification_rules_v2(event,'SELECT_LARGEST',1,100);
 ASSERT result->>'ok'='true',result::text;
 result:=public.floor_add_manual_player_v1(tour,'Rules locked TEST',tt,1,sess,rev,epoch,request,actor);
 ASSERT result->>'ok'='true',result::text;
 replay:=public.floor_add_manual_player_v1(tour,'Rules locked TEST',tt,1,sess,rev,epoch,request,actor);
 ASSERT replay=result,'manual replay differed';
 proof:=public.get_floor_manual_player_receipt_v1(tour,request,actor);
 ASSERT proof->>'status'='resolved' AND proof->'result'=result,'manual public receipt mismatch';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id=tour)=1;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id
   JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no
   WHERE e.id=(result->>'entry_id')::uuid AND e.source='manual' AND e.registration_id IS NULL
     AND e.status='seated' AND e.current_stack=20000 AND s.chip_count=20000 AND c.chip_count=20000
     AND s.tournament_table_id=tt AND s.table_session_id=sess);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id=tour);
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id=tour);
 -- A distinct fresh event keeps the retarget/legacy cases independent of the
 -- now-frozen rules of the canonical Floor positive case.
 PERFORM set_config('role','authenticated',true);
 created:=public.create_tournament_event_with_flights_v2(club,
   jsonb_build_object('name','Rules retarget local TEST','itm_percent',15,'buy_in',100000,
    'rake_amount',10000,'starting_stack',20000,'game_type','nlh','minutes_per_level',20,
    'late_reg_close_level',6,'flight_count',1,'final_start_time','2026-11-10T12:00:00+07'),
   '[]'::jsonb,gen_random_uuid(),actor);
 ASSERT created->>'ok'='true',created::text;
 target_event:=(created->>'event_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT id INTO STRICT target_tour FROM public.tournaments WHERE event_id=target_event AND phase='flight';
 BEGIN
  UPDATE public.tournament_entries SET tournament_id=target_tour WHERE id=(result->>'entry_id')::uuid;
  RAISE EXCEPTION 'EXPECTED_RETARGET_REJECTION_MISSING';
 EXCEPTION WHEN check_violation THEN
  ASSERT SQLERRM='multi_day_rules_required_before_entry',SQLERRM;
 END;
 ASSERT (SELECT tournament_id FROM public.tournament_entries WHERE id=(result->>'entry_id')::uuid)=tour;
 -- Existing pre-rollout entries must retain ordinary update paths. Fixture only;
 -- no existing historical entry is moved, reopened or rewritten.
 UPDATE public.multi_day_package_release_v1 SET enabled=false WHERE id;
 INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,source,current_stack)
 VALUES(legacy_entry,target_tour,actor,1,'manual',20000);
 UPDATE public.multi_day_package_release_v1 SET enabled=true WHERE id;
 UPDATE public.tournament_entries SET current_stack=current_stack WHERE id=legacy_entry;
 ASSERT (SELECT current_stack FROM public.tournament_entries WHERE id=legacy_entry)=20000;
 RAISE NOTICE 'CANONICAL_FLOOR_RULES_BOUNDARY_PASS';
END $$;
