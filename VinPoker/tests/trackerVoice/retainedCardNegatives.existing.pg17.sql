-- Real next canonical hand inside one rolled-back transaction of the retained tour.
-- Never rewrite a completed hand or retain an extra hand to manufacture evidence.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
 WHERE t.id='46cab483-91e7-4220-aacf-e17bdf05269c' AND t.name='Cash identity local TEST'
 AND c.owner_id='675fe35e-60a8-4452-bb90-e79486d54da6');
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
 AND closed_at IS NULL AND control_mode IN('manual','tracker'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND status='in_progress');
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
DO $$ DECLARE r jsonb; s public.table_sessions; h uuid; n integer; before_revision bigint; cards jsonb;
 big_player uuid; short_player uuid; short_entry integer; action_key text; BEGIN
 SELECT * INTO s FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
 SELECT coalesce(max(hand_number),0)+1 INTO n FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';
 PERFORM set_config('role','authenticated',true);
 IF s.control_mode='manual' THEN
 r:=public.floor_request_table_control_mode_v4('d294f4a4-082b-4efc-a6ca-1f96579ea344',s.id,'tracker',s.revision,s.control_epoch,gen_random_uuid());
 ASSERT r->>'outcome'='applied',r::text;
 END IF;
 PERFORM set_config('role','none',true);
 SELECT * INTO s FROM public.table_sessions WHERE id=s.id;
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3('46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',s.id,s.control_epoch,n,now(),auth.uid(),1);
 ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);
 SELECT id,source_revision INTO h,before_revision FROM public.tournament_hands
 WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND hand_number=n;
 ASSERT h IS NOT NULL;
 PERFORM set_config('role','authenticated',true);
 r:=public.heartbeat_lock(h,auth.uid());ASSERT r->>'status'='success',r::text;
 IF current_setting('test.tracker_action_negatives',true)='1' THEN
  PERFORM set_config('role','none',true);
  SELECT player_id INTO big_player FROM public.hand_players WHERE hand_id=h AND seat_number=1 AND starting_stack=59400;
  SELECT player_id,entry_number INTO short_player,short_entry FROM public.hand_players WHERE hand_id=h AND seat_number=2 AND starting_stack=600;
  ASSERT big_player IS NOT NULL AND short_player IS NOT NULL,'exact current retained stacks required';
  PERFORM set_config('role','authenticated',true);
  r:=public.record_action(h,big_player,'post_sb',1,1,'preflop',100,gen_random_uuid()::text,NULL,auth.uid());
  ASSERT r->>'status'='success','positive SB control: '||r::text;
  r:=public.record_action(h,short_player,'post_bb',2,short_entry,'preflop',200,gen_random_uuid()::text,NULL,auth.uid());
  ASSERT r->>'status'='success','positive BB control: '||r::text;
  IF current_setting('test.tracker_legacy_negative',true)='1' THEN
   -- Model an already-existing pre189 bad row. Restore this candidate's trigger
   -- before the tested RPC. All DDL/data are isolated in this rollback transaction.
   PERFORM set_config('role','none',true);
   ALTER TABLE public.hand_actions DISABLE TRIGGER trg_guard_tracker_action_stack189;
   INSERT INTO public.hand_actions(hand_id,player_id,entry_number,street,action_type,action_amount,action_order)
   VALUES(h,short_player,short_entry,'preflop','call',-100,9);
   ALTER TABLE public.hand_actions ENABLE TRIGGER trg_guard_tracker_action_stack189;
   PERFORM set_config('role','authenticated',true);
   r:=public.record_action(h,short_player,'all_in',3,short_entry,'preflop',401,gen_random_uuid()::text,NULL,auth.uid());
   ASSERT r->>'error'='tracker_action_stack_evidence_missing','LEGACY_NEGATIVE_REOPENED_STACK_BUDGET: '||r::text;
   -- Remove only this transaction-local synthetic legacy fault, not real history.
   DELETE FROM public.hand_actions WHERE hand_id=h AND action_order=9;
  END IF;
  r:=public.record_action(h,short_player,'all_in',3,short_entry,'preflop',401,gen_random_uuid()::text,NULL,auth.uid());
  ASSERT coalesce(r->>'status','')<>'success','OVERSTACK_ACTION_ACCEPTED: 600 start - 200 BB leaves only 400; '||r::text;
  ASSERT r->>'error'='tracker_action_stack_exceeded',r::text;
  r:=public.record_action(h,short_player,'bet',3,short_entry,'preflop',-1,gen_random_uuid()::text,NULL,auth.uid());
  ASSERT r->>'error'='tracker_action_negative_amount',r::text;
  BEGIN
   INSERT INTO public.hand_actions(hand_id,player_id,entry_number,street,action_type,action_amount,action_order)
   VALUES(h,short_player,short_entry,'preflop','all_in',401,3);
   RAISE EXCEPTION 'direct action insert bypassed stack guard';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tracker_action_stack_exceeded',SQLERRM;END;
  BEGIN
   UPDATE public.hand_actions SET action_amount=601 WHERE hand_id=h AND player_id=short_player AND action_type='post_bb';
   RAISE EXCEPTION 'direct action update bypassed stack guard';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tracker_action_stack_exceeded',SQLERRM;END;
  PERFORM set_config('role','none',true);
  ASSERT NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id=h AND action_order=3);
  action_key:=gen_random_uuid()::text;
  PERFORM set_config('role','authenticated',true);
  r:=public.record_action(h,short_player,'all_in',3,short_entry,'preflop',400,action_key,NULL,auth.uid());
  ASSERT r->>'status'='success','exact remaining-stack control: '||r::text;
  r:=public.record_action(h,short_player,'all_in',3,short_entry,'preflop',400,action_key,NULL,auth.uid());
  ASSERT r->>'status'='success' AND r->>'duplicate'='true','exact-stack replay failed: '||r::text;
  r:=public.record_action(h,short_player,'all_in',3,short_entry,'preflop',399,action_key,NULL,auth.uid());
  ASSERT r->>'error'='idempotency_key_conflict',r::text;
  PERFORM set_config('role','none',true);
  ASSERT (SELECT count(*) FROM public.hand_actions WHERE hand_id=h AND action_order=3)=1;
  ASSERT NOT has_function_privilege('authenticated','floor_private.guard_tracker_action_stack189()','EXECUTE');
  ASSERT NOT has_function_privilege('anon','floor_private.guard_tracker_action_stack189()','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','floor_private.guard_tracker_action_stack189()','EXECUTE');
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',true);
  PERFORM set_config('role','authenticated',true);
  BEGIN
   INSERT INTO public.hand_actions(hand_id,player_id,entry_number,street,action_type,action_amount,action_order)
   VALUES(h,big_player,1,'preflop','bet',1,4);
   RAISE EXCEPTION 'outsider action insert passed RLS';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  r:=public.record_action(h,big_player,'bet',4,1,'preflop',1,gen_random_uuid()::text,NULL,auth.uid());
  ASSERT coalesce(r->>'status','')<>'success','outsider record_action accepted';
  PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}',true);
  PERFORM set_config('role','none',true);
  SELECT source_revision INTO before_revision FROM public.tournament_hands WHERE id=h;
  PERFORM set_config('role','authenticated',true);
 END IF;
 r:=public.update_community_cards(h,'["As","As","2c"]',auth.uid());
 ASSERT coalesce(r->>'status','')<>'success' AND coalesce((r->>'ok')::boolean,false)=false,
 'DUPLICATE_BOARD_ACCEPTED: '||r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT community_cards IS NULL OR community_cards='[]'::jsonb FROM public.tournament_hands WHERE id=h);
 PERFORM set_config('role','authenticated',true);
 r:=public.update_community_cards(h,'["As","Kd"]',auth.uid());
 ASSERT coalesce(r->>'status','')<>'success' AND coalesce((r->>'ok')::boolean,false)=false,
 'TWO_CARD_BOARD_ACCEPTED: '||r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT community_cards IS NULL OR community_cards='[]'::jsonb FROM public.tournament_hands WHERE id=h);
 ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id=h)=before_revision,
 'rejected card intent changed revision';
 PERFORM set_config('role','authenticated',true);
 r:=public.update_community_cards(h,'["As","Kd","2c"]',auth.uid());
 ASSERT r->>'status'='success','positive board control failed: '||r::text;
 PERFORM set_config('role','none',true);
 SELECT source_revision INTO before_revision FROM public.tournament_hands WHERE id=h;
 SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,
 'hole_cards',CASE WHEN seat_number=1 THEN '["As","Qd"]'::jsonb ELSE '["Js","Jd"]'::jsonb END) ORDER BY seat_number)
 INTO cards FROM public.hand_players WHERE hand_id=h;
 ASSERT jsonb_array_length(cards)=2;
 PERFORM set_config('role','authenticated',true);
 r:=public.show_tracker_manual_cards_v1(h,s.id,s.control_epoch,before_revision,gen_random_uuid()::text,cards);
 ASSERT coalesce(r->>'status','')<>'success' AND coalesce((r->>'ok')::boolean,false)=false,
 'BOARD_HOLE_DUPLICATE_ACCEPTED: '||r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id=h)=before_revision;
 cards:=jsonb_set(cards,'{0,hole_cards}','["Qs","Qd"]');
 PERFORM set_config('role','authenticated',true);
 r:=public.show_tracker_manual_cards_v1(h,s.id,s.control_epoch,before_revision,gen_random_uuid()::text,cards);
 ASSERT r->>'status'='success','positive private cards control failed: '||r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.hand_players WHERE hand_id=h AND jsonb_array_length(hole_cards)=2)=2;
 SELECT source_revision INTO before_revision FROM public.tournament_hands WHERE id=h;
 cards:=jsonb_set(cards,'{1,hole_cards}','["Qs","Jh"]');
 PERFORM set_config('role','authenticated',true);
 r:=public.show_tracker_manual_cards_v1(h,s.id,s.control_epoch,before_revision,gen_random_uuid()::text,cards);
 ASSERT coalesce(r->>'status','')<>'success' AND coalesce((r->>'ok')::boolean,false)=false,
 'SHARED_PRIVATE_CARD_ACCEPTED: '||r::text;
 r:=public.update_community_cards(h,'["Qs","Kd","2c"]',auth.uid());
 ASSERT coalesce(r->>'status','')<>'success' AND coalesce((r->>'ok')::boolean,false)=false,
 'PRIVATE_CARD_MOVED_TO_BOARD: '||r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id=h)=before_revision;
 ASSERT (SELECT community_cards FROM public.tournament_hands WHERE id=h)='["As","Kd","2c"]'::jsonb;
 ASSERT NOT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id=h AND hole_cards='["Qs","Jh"]'::jsonb);
 RAISE NOTICE 'RETAINED_CANONICAL_NEXT_HAND_INVALID_BOARD_DUPLICATE_CARD_DENIED_POSITIVE_CONTROLS_PASS: %',h;
END $$;
RESET ROLE;
ROLLBACK;
\echo RETAINED_CARD_NEGATIVES_ROLLED_BACK_PASS
