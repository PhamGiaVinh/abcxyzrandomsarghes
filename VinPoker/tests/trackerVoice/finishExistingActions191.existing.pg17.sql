-- Repeatable fresh canonical child hand; all child writes roll back.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND status='in_progress');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb' AND status='completed' AND source_revision=16);
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
DO $$ DECLARE actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';
 tab uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';s public.table_sessions;h uuid;n integer;revision bigint;
 r jsonb;i jsonb;actions jsonb;players jsonb;cards jsonb;a jsonb;expected jsonb;
 report_key uuid;alert_id uuid;mode_request uuid;alert_rows jsonb;
BEGIN
 SELECT * INTO s FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc';ASSERT s.closed_at IS NULL AND s.control_mode='tracker';
 SELECT max(hand_number)+1 INTO n FROM public.tournament_hands WHERE tournament_id=tour;
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3(tour,tab,s.id,s.control_epoch,n,now(),actor,1);ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);
 SELECT id INTO h FROM public.tournament_hands WHERE tournament_id=tour AND hand_number=n;
 SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'street',street,'action_type',action_type,'action_amount',action_amount,'action_order',action_order) ORDER BY action_order)
 INTO actions FROM public.hand_actions WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb';
 SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'seat_number',seat_number,'starting_stack',starting_stack,'ending_stack',ending_stack,'hole_cards',hole_cards,'is_eliminated',false) ORDER BY seat_number),
 jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'hole_cards',hole_cards)) INTO players,cards
 FROM public.hand_players WHERE hand_id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb';
 PERFORM set_config('role','authenticated',true);
 r:=public.heartbeat_lock(h,actor);ASSERT r->>'status'='success',r::text;
 FOR a IN SELECT * FROM jsonb_array_elements(actions) LOOP
  r:=public.record_action(h,(a->>'player_id')::uuid,a->>'action_type',(a->>'action_order')::integer,(a->>'entry_number')::integer,a->>'street',(a->>'action_amount')::integer);
  ASSERT r->>'status'='success',r::text;
 END LOOP;
 r:=public.update_community_cards(h,'["As","Ks","Qs","Js","Ts"]',actor);ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);SELECT source_revision INTO revision FROM public.tournament_hands WHERE id=h;
 PERFORM set_config('role','authenticated',true);
 r:=public.show_tracker_manual_cards_v1(h,s.id,s.control_epoch,revision,gen_random_uuid()::text,cards);ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);SELECT source_revision INTO revision FROM public.tournament_hands WHERE id=h;
 -- Real whole-hand report and mode blocker on the same fresh canonical hand.
 -- Roll back this subcase, not the hand or retained historical proof.
 BEGIN
  INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled)
  VALUES('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour,tab,actor,'report_wrong_action',true)
  ON CONFLICT DO NOTHING;
  report_key:=gen_random_uuid();
  SELECT * INTO s FROM public.table_sessions WHERE id=s.id;
  PERFORM set_config('role','authenticated',true);
  r:=public.report_tracker_wrong_hand_v1(tour,tab,h,revision,report_key);
  ASSERT r->>'ok'='true' AND r->>'scope'='whole_hand',r::text;
  alert_id:=(r->>'alert_id')::uuid;
  r:=public.report_tracker_wrong_hand_v1(tour,tab,h,revision,report_key);
  ASSERT r->>'duplicate'='true' AND (r->>'alert_id')::uuid=alert_id,r::text;
  r:=public.report_tracker_wrong_hand_v1(tour,tab,h,revision+1,report_key);
  ASSERT r->>'error'='request_key_conflict',r::text;
  r:=public.report_tracker_wrong_hand_v1(tour,tab,h,revision+1,gen_random_uuid());
  ASSERT r->>'error'='stale_source_revision',r::text;
  r:=public.list_tracker_floor_alerts(tour,NULL);
  ASSERT r->>'ok'='true' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'alerts') item WHERE item->>'id'=alert_id::text AND item->'dealer_id'='null'::jsonb AND item->'assignment_id'='null'::jsonb),r::text;
  SELECT coalesce(jsonb_agg(t),'[]'::jsonb) INTO alert_rows FROM(
   SELECT physical_table_id FROM public.tracker_floor_alerts WHERE tournament_id=tour AND status IN ('open','acknowledged','in_progress'))t;
  ASSERT jsonb_array_length(alert_rows)=1,alert_rows::text;
  ASSERT alert_rows->0->>'physical_table_id'=s.game_table_id::text,alert_rows::text;
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',true);
  ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_floor_alerts WHERE tournament_id=tour),'outsider sees private correction alerts';
  r:=public.list_tracker_floor_alerts(tour,NULL);ASSERT r->>'error'='actor_not_allowed',r::text;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  r:=public.floor_request_table_control_mode_v4(tab,s.id,'manual',s.revision,s.control_epoch,gen_random_uuid());
  ASSERT r->>'outcome'='pending' AND r->'blockers' ? 'correction_pending',r::text;
  mode_request:=(r->>'request_id')::uuid;
  r:=public.floor_cancel_table_control_mode_request_v1(tab,s.id,mode_request);
  ASSERT r->>'outcome'='cancelled',r::text;
  ASSERT EXISTS(SELECT 1 FROM public.tracker_floor_alerts WHERE id=alert_id AND status='open' AND correction_required),'cancel erased correction';
  RAISE SQLSTATE 'PZ191';
 EXCEPTION WHEN SQLSTATE 'PZ191' THEN NULL;
 END;
 PERFORM set_config('role','none',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_floor_alerts WHERE hand_id=h),'report subcase leaked';
 RAISE NOTICE 'TRACKER_CANONICAL_REPORT_NONEMPTY_READ_MODE_BLOCK_CANCEL_ROLLBACK_PASS';
 i:=jsonb_build_object('actor_id',actor,'request_id',gen_random_uuid(),'tournament_id',tour,'tournament_table_id',tab,'hand_id',h,
  'table_session_id',s.id,'control_epoch',s.control_epoch,'source_revision',revision,'payload',jsonb_build_object(
   'hand_time',now(),'players',players,'actions',actions,'community_cards','["As","Ks","Qs","Js","Ts"]'::jsonb,
   'side_pots',(SELECT side_pots FROM public.tournament_hands WHERE id='fdb2996a-bb7d-4356-87aa-9d9a1bf281fb'),'pot_size',1200));
 IF current_setting('test.finish191.prepare',true)='true' THEN
  PERFORM set_config('test.finish191.intent',i::text,true);
  RETURN;
 END IF;
 -- Check the real Finish boundary at the retained session's current epoch.
 -- This subtransaction must not consume the following Finish regression's intent.
 BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id=s.id;
  PERFORM set_config('role','authenticated',true);
  r:=public.floor_request_table_control_mode_v4(tab,s.id,'manual',s.revision,s.control_epoch,gen_random_uuid());
  ASSERT r->>'outcome'='pending' AND r->'blockers' ? 'active_hand',r::text;
  mode_request:=(r->>'request_id')::uuid;
  PERFORM set_config('role','none',true);
  ASSERT (SELECT control_mode='tracker' AND control_epoch=s.control_epoch FROM public.table_sessions WHERE id=s.id),
   'pending request changed mode before Finish';
  PERFORM set_config('role','authenticated',true);
  r:=public.record_tracker_manual_hand_v1(i);ASSERT r->>'ok'='true',r::text;
  PERFORM set_config('role','none',true);
  -- Production callbacks are INITIALLY DEFERRED. Flush the actual triggers as
  -- COMMIT would, rather than inspecting a deliberately unfinished transaction.
  SET CONSTRAINTS ALL IMMEDIATE;
  ASSERT (SELECT control_mode='manual' AND control_epoch=s.control_epoch+1 FROM public.table_sessions WHERE id=s.id),
   'Finish did not apply pending mode exactly once';
  ASSERT EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 WHERE id=mode_request AND status='applied'),
   'Finish left mode request pending';
  RAISE SQLSTATE 'PZ192';
 EXCEPTION WHEN SQLSTATE 'PZ192' THEN NULL;
 END;
 ASSERT (SELECT status='in_progress' FROM public.tournament_hands WHERE id=h),'Finish boundary subcase leaked';
 RAISE NOTICE 'FINISH191_CURRENT_EPOCH_ACTIVE_HAND_PENDING_APPLY_ROLLBACK_PASS';
 PERFORM set_config('role','authenticated',true);
 r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{control_epoch}',to_jsonb(s.control_epoch+1)));
 ASSERT r->>'error'='stale_manual_finish_context',r::text;
 r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{tournament_id}',to_jsonb(gen_random_uuid()::text)));
 ASSERT r->>'error'='actor_not_allowed',r::text;
 PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',true);
 r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{actor_id}','"11111111-1111-4111-8111-111111111111"'));
 ASSERT r->>'error'='actor_not_allowed',r::text;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload,actions,4,street}','"river"'));
 ASSERT r->>'error'='action_conflict',r::text;
 BEGIN
  r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload,actions}',actions||jsonb_build_array(
   jsonb_build_object('player_id',actions->4->>'player_id','entry_number',actions->4->'entry_number','street','preflop','action_type','bet','action_amount',58801,'action_order',6))));
  RAISE EXCEPTION 'new overstack action passed191:%',r;
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tracker_action_stack_exceeded',SQLERRM;END;
 r:=public.record_tracker_manual_hand_v1(i);ASSERT r->>'ok'='true',r::text;expected:=r;
 r:=public.record_tracker_manual_hand_v1(i);ASSERT r=expected,'receipt replay differs';
 r:=public.record_tracker_manual_hand_v1(jsonb_set(i,'{payload,pot_size}','1201'));ASSERT r->>'error'='IDEMPOTENCY_CONFLICT',r::text;
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.hand_actions WHERE hand_id=h)=5;
 ASSERT (SELECT status FROM public.tournament_hands WHERE id=h)='completed';
END $$;
ROLLBACK;
SELECT 'FINISH191_FRESH_CHILD_EXISTING_CONFLICT_NEW_BUDGET_RECEIPT_ROLLBACK_PASS';
