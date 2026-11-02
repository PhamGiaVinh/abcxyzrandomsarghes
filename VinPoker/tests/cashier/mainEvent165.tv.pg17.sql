-- Existing browser-created, unpaid TEST event. Every mutation is rolled back by parent.
DO $$
DECLARE e public.tournament_events%ROWTYPE; a uuid; b uuid; token_a text; token_b text;
 p jsonb; q jsonb; branding boolean; other_club uuid; mismatch_token text;
BEGIN
 SELECT * INTO STRICT e FROM public.tournament_events WHERE id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 ASSERT e.name='Main Event browser local TEST 164' AND e.guarantee_amount=2500000;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_registrations r JOIN public.tournaments t ON t.id=r.tournament_id WHERE t.event_id=e.id);
 SELECT id INTO STRICT a FROM public.tournaments WHERE event_id=e.id AND flight_label='A';
 SELECT id INTO STRICT b FROM public.tournaments WHERE event_id=e.id AND flight_label='B';
 token_a:='fixture-only-main-event165-a-'||gen_random_uuid();
 token_b:='fixture-only-main-event165-b-'||gen_random_uuid();
 INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
 VALUES(gen_random_uuid(),e.club_id,token_a,a,'paired'),(gen_random_uuid(),e.club_id,token_b,b,'paired');
 UPDATE public.tournament_levels SET big_blind=big_blind+100 WHERE tournament_id=b AND level_number=1;
 FOREACH branding IN ARRAY ARRAY[false,true] LOOP
  PERFORM set_config('role','anon',true);
  p:=public.get_tv_display_state_v4(token_a,branding);
  q:=public.get_tv_display_state_v4(token_b,branding);
  PERFORM set_config('role','none',true);
  ASSERT p->>'status'='paired' AND q->>'status'='paired';
  ASSERT p->'main_event'=jsonb_build_object('id',e.id,'name',e.name,'guarantee_amount',2500000), 'event GTD missing or wrongly scoped';
  ASSERT q->'main_event'=p->'main_event','flights must share only their canonical event GTD';
  ASSERT p->'tournament'->>'id'=a::text AND q->'tournament'->>'id'=b::text;
  ASSERT p->'clock'->>'tournament_id'=a::text AND q->'clock'->>'tournament_id'=b::text;
  ASSERT p->'tournament'->'prize_pool'=q->'tournament'->'prize_pool','GTD must not alter flight prize pool';
  ASSERT p->'levels'->0->>'big_blind' IS DISTINCT FROM q->'levels'->0->>'big_blind','flight level state leaked';
 END LOOP;
 UPDATE public.tournament_events SET guarantee_amount=NULL WHERE id=e.id;
 p:=public.get_tv_display_state_v4(token_a,false);
 ASSERT p->'main_event'->'guarantee_amount'='null'::jsonb,'unknown GTD must remain null';
 UPDATE public.tournament_events SET guarantee_amount=0 WHERE id=e.id;
 p:=public.get_tv_display_state_v4(token_a,false);
 ASSERT p->'main_event'->>'guarantee_amount'='0','explicit no-GTD must remain zero';
 UPDATE public.tv_displays SET status='revoked' WHERE display_token=token_a;
 p:=public.get_tv_display_state_v4(token_a,false);
 ASSERT p->>'status'='revoked' AND NOT p ? 'main_event','revoked token leaked event metadata';
 p:=public.get_tv_display_state_v4('invalid',false);
 ASSERT p->>'status'='invalid' AND NOT p ? 'main_event';
 SELECT id INTO STRICT other_club FROM public.clubs WHERE id<>e.club_id ORDER BY id LIMIT 1;
 mismatch_token:='fixture-only-main-event165-mismatch-'||gen_random_uuid();
 INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
 VALUES(gen_random_uuid(),other_club,mismatch_token,a,'paired');
 PERFORM set_config('role','anon',true);
 p:=public.get_tv_display_state_v4(mismatch_token,false);
 PERFORM set_config('role','none',true);
 ASSERT p->>'status'='invalid' AND NOT p ? 'main_event','cross-club display leaked metadata';
 ASSERT NOT has_function_privilege('service_role','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
 ASSERT has_function_privilege('anon','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
 RAISE NOTICE 'MAIN_EVENT165_ANON_GTD_NULL_ZERO_TWO_FLIGHT_PROJECTION_PASS';
END $$;
