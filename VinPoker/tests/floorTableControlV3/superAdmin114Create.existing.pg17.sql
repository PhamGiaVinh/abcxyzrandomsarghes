BEGIN;
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2' AND owner_id='f793a5b3-6025-4766-bc1b-49f16aa1b44a' AND name='Cash identity local TEST')
 THEN RAISE EXCEPTION 'superadmin114_scope';END IF;
END $guard$;
SELECT set_config('test.superadmin114_actor',gen_random_uuid()::text,true);
SELECT set_config('test.superadmin114_key',gen_random_uuid()::text,true);
SELECT set_config('test.superadmin114_config','{"name":"SuperAdmin114 local TEST","start_time":"2026-12-20T12:00:00+07:00","buy_in":100000,"rake_amount":0,"service_fee_amount":0,"starting_stack":20000,"game_type":"nlh","minutes_per_level":20,"late_reg_close_level":6}',true);
INSERT INTO auth.users(id) VALUES(current_setting('test.superadmin114_actor')::uuid);
SELECT set_config('request.jwt.claim.sub',current_setting('test.superadmin114_actor'),true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('test.superadmin114_actor'))::text,true);
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $denied$ DECLARE r jsonb;BEGIN
 r:=public.create_tournament_with_levels_v1('8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',current_setting('test.superadmin114_config')::jsonb,'[]',current_setting('test.superadmin114_key')::uuid,auth.uid());
 IF r->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'superadmin114_outsider: %',r;END IF;
END $denied$;
RESET ROLE;
INSERT INTO public.user_roles(user_id,role) VALUES(current_setting('test.superadmin114_actor')::uuid,'super_admin');
SET LOCAL ROLE authenticated;
DO $admin$ DECLARE r jsonb;first jsonb;BEGIN
 r:=public.create_tournament_with_levels_v1('8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',current_setting('test.superadmin114_config')::jsonb,
  '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',current_setting('test.superadmin114_key')::uuid,auth.uid());
 IF r->>'error' IS DISTINCT FROM 'blind_levels_not_allowed' THEN RAISE EXCEPTION 'superadmin114_blind_authority_not_preserved: %',r;END IF;
 first:=public.create_tournament_with_levels_v1('8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',current_setting('test.superadmin114_config')::jsonb,'[]',current_setting('test.superadmin114_key')::uuid,auth.uid());
 IF first->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'superadmin114_create: %',first;END IF;
 PERFORM set_config('test.superadmin114_tour',first->>'tournament_id',true);
 r:=public.get_tournament_create_receipt_v1('8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',current_setting('test.superadmin114_config')::jsonb,'[]',current_setting('test.superadmin114_key')::uuid,auth.uid());
 IF r IS DISTINCT FROM first THEN RAISE EXCEPTION 'superadmin114_receipt_read';END IF;
 r:=public.create_tournament_with_levels_v1('8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',current_setting('test.superadmin114_config')::jsonb,'[]',current_setting('test.superadmin114_key')::uuid,auth.uid());
 IF r IS DISTINCT FROM first THEN RAISE EXCEPTION 'superadmin114_replay';END IF;
 r:=public.create_tournament_with_levels_v1('8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',current_setting('test.superadmin114_config')::jsonb||'{"buy_in":200000}','[]',current_setting('test.superadmin114_key')::uuid,auth.uid());
 IF r->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'superadmin114_payload_conflict: %',r;END IF;
END $admin$;
RESET ROLE;
DO $post$ BEGIN
 IF (SELECT count(*) FROM public.tournaments WHERE name='SuperAdmin114 local TEST')<>1
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=current_setting('test.superadmin114_tour')::uuid AND club_id='8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2' AND buy_in=100000 AND starting_stack=20000 AND live_status='registering')
 OR EXISTS(SELECT 1 FROM public.tournament_levels WHERE tournament_id=current_setting('test.superadmin114_tour')::uuid)
 THEN RAISE EXCEPTION 'superadmin114_parent_level_values';END IF;
END $post$;
ROLLBACK;
SELECT 'SUPERADMIN114_REAL_RPC_OUTSIDER_DENIED_ADMIN_CREATE_RECEIPT_REPLAY_CONFLICT_NO_BLIND_ESCALATION_ROLLBACK_PASS';
