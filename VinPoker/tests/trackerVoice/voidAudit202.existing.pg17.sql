BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND status='in_progress' AND NOT is_voided)
 OR NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='f420f331-d986-4278-acba-dcdb7303a5ba' AND status='voided' AND is_voided)
 THEN RAISE EXCEPTION 'void202_exact_fixture_guard';END IF;
END $$;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
DO $test$ DECLARE actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';
 tab uuid:='d294f4a4-082b-4efc-a6ca-1f96579ea344';session_id uuid:='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
 epoch bigint;revision bigint;n integer;h uuid;r jsonb;before_hand jsonb;before_players jsonb;before_actions jsonb;snapshot record;closed_hand uuid;role_name text;
BEGIN
 SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=session_id AND closed_at IS NULL AND control_mode='tracker';
 IF epoch IS NULL THEN RAISE EXCEPTION 'void202_session_guard';END IF;
 SELECT coalesce(max(hand_number),0)+1 INTO n FROM public.tournament_hands WHERE tournament_id=tour;
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3(tour,tab,session_id,epoch,n,now(),actor,2);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'void202_start %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT id INTO STRICT h FROM public.tournament_hands WHERE tournament_id=tour AND hand_number=n;
 PERFORM set_config('role','authenticated',true);
 r:=public.record_action(h,'533feda3-28c5-4194-bdf3-53a07c41305b','post_sb',1,1,'preflop',100);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'void202_sb %',r;END IF;
 r:=public.record_action(h,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','post_bb',2,1,'preflop',200);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'void202_bb %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT source_revision INTO revision FROM public.tournament_hands WHERE id=h;
 PERFORM set_config('role','authenticated',true);
 r:=public.show_tracker_manual_cards_v1(h,session_id,epoch,revision,gen_random_uuid()::text,
 '[{"player_id":"533feda3-28c5-4194-bdf3-53a07c41305b","entry_number":1,"hole_cards":["As","Ah"]},{"player_id":"5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103","entry_number":1,"hole_cards":["Ks","Kh"]}]');
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'void202_cards %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT to_jsonb(x) INTO before_hand FROM public.tournament_hands x WHERE id=h;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seat_number,p.player_id,p.entry_number,p.id) INTO before_players FROM public.hand_players p WHERE hand_id=h;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY a.action_order,a.id) INTO before_actions FROM public.hand_actions a WHERE hand_id=h;
 IF jsonb_array_length(before_actions)<>2 THEN RAISE EXCEPTION 'void202_source_setup';END IF;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',true);
  PERFORM set_config('role','authenticated',true);r:=public.void_last_hand(h);
  IF r->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'void202_outsider %',r;END IF;
  RAISE SQLSTATE 'PZ202';
 EXCEPTION WHEN SQLSTATE 'PZ202' THEN NULL;END;
 IF EXISTS(SELECT 1 FROM floor_private.tracker_void_snapshots202 WHERE hand_id=h) THEN RAISE EXCEPTION 'void202_denial_created_audit';END IF;
 EXECUTE $ddl$CREATE FUNCTION public.test_void202_snapshot_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'TEST_VOID202_SNAPSHOT_FAILURE';END $fn$;$ddl$;
 EXECUTE 'CREATE TRIGGER test_void202_snapshot_failure BEFORE INSERT ON floor_private.tracker_void_snapshots202 FOR EACH ROW EXECUTE FUNCTION public.test_void202_snapshot_failure()';
 BEGIN
  PERFORM set_config('role','authenticated',true);PERFORM public.void_last_hand(h);
  RAISE EXCEPTION 'void202_expected_snapshot_failure_missing';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TEST_VOID202_SNAPSHOT_FAILURE' THEN RAISE;END IF;END;
 PERFORM set_config('role','none',true);
 IF (SELECT to_jsonb(x) FROM public.tournament_hands x WHERE id=h) IS DISTINCT FROM before_hand
 OR (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.action_order,a.id) FROM public.hand_actions a WHERE hand_id=h) IS DISTINCT FROM before_actions
 OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seat_number,p.player_id,p.entry_number,p.id) FROM public.hand_players p WHERE hand_id=h) IS DISTINCT FROM before_players
 OR EXISTS(SELECT 1 FROM floor_private.tracker_void_snapshots202 WHERE hand_id=h) THEN RAISE EXCEPTION 'void202_snapshot_failure_was_not_atomic';END IF;
 EXECUTE 'DROP TRIGGER test_void202_snapshot_failure ON floor_private.tracker_void_snapshots202';
 EXECUTE 'DROP FUNCTION public.test_void202_snapshot_failure()';
 PERFORM set_config('role','authenticated',true);r:=public.void_last_hand(h);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'void202_active_void %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT * INTO STRICT snapshot FROM floor_private.tracker_void_snapshots202 WHERE hand_id=h;
 IF snapshot.hand_snapshot IS DISTINCT FROM before_hand OR snapshot.players_snapshot IS DISTINCT FROM before_players OR snapshot.actions_snapshot IS DISTINCT FROM before_actions
 OR snapshot.actor_id<>actor OR snapshot.tournament_id<>tour OR snapshot.club_id<>'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
 OR snapshot.snapshot_digest<>md5(jsonb_build_object('hand',before_hand,'players',before_players,'actions',before_actions)::text)
 OR (SELECT count(*) FROM public.hand_actions WHERE hand_id=h)<>0 THEN RAISE EXCEPTION 'void202_lossless_archive_mismatch';END IF;
 BEGIN UPDATE floor_private.tracker_void_snapshots202 SET snapshot_digest=repeat('0',32) WHERE hand_id=h;
  RAISE EXCEPTION 'void202_update_should_fail';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM<>'tracker_void_snapshot_immutable' THEN RAISE;END IF;END;
 BEGIN DELETE FROM floor_private.tracker_void_snapshots202 WHERE hand_id=h;
  RAISE EXCEPTION 'void202_delete_should_fail';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM<>'tracker_void_snapshot_immutable' THEN RAISE;END IF;END;
 SELECT id INTO STRICT closed_hand FROM public.tournament_hands WHERE tournament_id=tour AND hand_number=29 AND status='completed' AND NOT is_voided;
 SELECT to_jsonb(x) INTO before_hand FROM public.tournament_hands x WHERE id=closed_hand;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seat_number,p.player_id,p.entry_number,p.id) INTO before_players FROM public.hand_players p WHERE hand_id=closed_hand;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY a.action_order,a.id) INTO before_actions FROM public.hand_actions a WHERE hand_id=closed_hand;
 PERFORM set_config('role','authenticated',true);r:=public.void_last_hand(closed_hand);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'void202_completed_void %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT * INTO STRICT snapshot FROM floor_private.tracker_void_snapshots202 WHERE hand_id=closed_hand;
 IF snapshot.hand_snapshot IS DISTINCT FROM before_hand OR snapshot.players_snapshot IS DISTINCT FROM before_players OR snapshot.actions_snapshot IS DISTINCT FROM before_actions
 THEN RAISE EXCEPTION 'void202_completed_archive_mismatch';END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_table_privilege(role_name,'floor_private.tracker_void_snapshots202','SELECT,INSERT,UPDATE,DELETE')
  OR has_function_privilege(role_name,'floor_private.capture_tracker_void_snapshot202(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'void202_private_source_exposure_%',role_name;END IF;
  BEGIN
   PERFORM set_config('role',role_name,true);
   PERFORM floor_private.capture_tracker_void_snapshot202(h);
   RAISE EXCEPTION 'void202_direct_private_capture_should_fail_%',role_name;
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  PERFORM set_config('role','none',true);
  BEGIN
   PERFORM set_config('role',role_name,true);
   PERFORM hand_snapshot FROM floor_private.tracker_void_snapshots202 WHERE hand_id=h;
   RAISE EXCEPTION 'void202_direct_private_read_should_fail_%',role_name;
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  PERFORM set_config('role','none',true);
 END LOOP;
 IF NOT(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='floor_private.tracker_void_snapshots202'::regclass)
 THEN RAISE EXCEPTION 'void202_rls_missing';END IF;
END $test$;
ROLLBACK;
SELECT 'VOID202_RUNTIME_PRIVATE_IMMUTABLE_SNAPSHOT_FAULT_ROLLBACK_PASS';
