-- Exact retained LOCAL database only. Every probe is rolled back, including errors.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
 THEN RAISE EXCEPTION 'create374_local_only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'
  AND owner_id='675fe35e-60a8-4452-bb90-e79486d54da6') THEN RAISE EXCEPTION 'create374_actor_scope_drift'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.create_tournament_with_levels_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',
  '{"name":"LOCAL374 ROLLBACK invalid GTD","start_time":"2026-10-24T05:00:00Z","buy_in":100000,"rake_amount":0,"service_fee_amount":0,"guarantee_amount":-1,"starting_stack":20000,"game_type":"nlh","minutes_per_level":20,"late_reg_close_level":6}',
  '[]'::jsonb,gen_random_uuid(),'675fe35e-60a8-4452-bb90-e79486d54da6');
 IF result->>'ok'='true' THEN RAISE EXCEPTION 'CREATE374_INVALID_GTD_ACCEPTED'; END IF;
 IF result->>'error' IS DISTINCT FROM 'invalid_create_money' THEN
  RAISE EXCEPTION 'create374_unexpected_denial: %',result->>'error'; END IF;
END $$;
DO $$ DECLARE result jsonb; field text; bad jsonb; payload jsonb; BEGIN
 FOREACH field IN ARRAY ARRAY['buy_in','rake_amount','service_fee_amount','guarantee_amount'] LOOP
  FOREACH bad IN ARRAY ARRAY['-1'::jsonb,'"100"'::jsonb] LOOP
   payload:='{"name":"LOCAL374 ROLLBACK invalid money","start_time":"2026-10-24T05:00:00Z","buy_in":100000,"rake_amount":0,"service_fee_amount":0,"guarantee_amount":2500000,"starting_stack":20000,"game_type":"nlh","minutes_per_level":20,"late_reg_close_level":6}'::jsonb;
   result:=public.create_tournament_with_levels_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',
    jsonb_set(payload,ARRAY[field],bad),'[]'::jsonb,gen_random_uuid(),'675fe35e-60a8-4452-bb90-e79486d54da6');
   IF result->>'error' IS DISTINCT FROM 'invalid_create_money' THEN
    RAISE EXCEPTION 'create374_bad_money_accepted_or_wrong_denial: % % %',field,bad,result; END IF;
  END LOOP;
 END LOOP;
 FOREACH bad IN ARRAY ARRAY['0.5'::jsonb,'9007199254740992'::jsonb] LOOP
  result:=public.create_tournament_with_levels_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',
   jsonb_set(payload,ARRAY['guarantee_amount'],bad),'[]'::jsonb,gen_random_uuid(),'675fe35e-60a8-4452-bb90-e79486d54da6');
  IF result->>'error' IS DISTINCT FROM 'invalid_create_money' THEN RAISE EXCEPTION 'create374_bad_gtd_accepted'; END IF;
 END LOOP;
END $$;
DO $$ DECLARE result jsonb; replay jsonb; guarantee jsonb; request_id uuid; payload jsonb; BEGIN
 FOREACH guarantee IN ARRAY ARRAY['null'::jsonb,'0'::jsonb,'2500000'::jsonb] LOOP
  request_id:=gen_random_uuid();
  payload:=jsonb_set('{"name":"LOCAL374 ROLLBACK valid GTD","start_time":"2026-10-24T05:00:00Z","buy_in":100000,"rake_amount":0,"service_fee_amount":0,"starting_stack":20000,"game_type":"nlh","minutes_per_level":20,"late_reg_close_level":6}'::jsonb,ARRAY['guarantee_amount'],guarantee);
  result:=public.create_tournament_with_levels_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',payload,'[]'::jsonb,request_id,'675fe35e-60a8-4452-bb90-e79486d54da6');
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'create374_valid_denied: %',result; END IF;
  replay:=public.create_tournament_with_levels_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',payload,'[]'::jsonb,request_id,'675fe35e-60a8-4452-bb90-e79486d54da6');
  IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'create374_replay_changed'; END IF;
  replay:=public.create_tournament_with_levels_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',jsonb_set(payload,ARRAY['name'],'"Changed intent"'),'[]'::jsonb,request_id,'675fe35e-60a8-4452-bb90-e79486d54da6');
  IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'create374_conflict_missing'; END IF;
 END LOOP;
END $$;
DO $$ DECLARE result jsonb; replay jsonb; request_id uuid:=gen_random_uuid(); rows jsonb; BEGIN
 rows:='[{"club_id":"a8e7d1b7-fdaa-45ad-b0a1-f894b6315760","name":"LOCAL374 ROLLBACK batch A","start_time":"2026-10-24T05:00:00Z","buy_in":100000,"starting_stack":20000,"game_type":"nlh","location":null},{"club_id":"a8e7d1b7-fdaa-45ad-b0a1-f894b6315760","name":"LOCAL374 ROLLBACK batch B","start_time":"2026-10-24T06:00:00Z","buy_in":0,"starting_stack":20000,"game_type":"nlh","location":null}]';
 result:=public.create_tournament_schedule_batch_v1(p_expected_actor_id=>'675fe35e-60a8-4452-bb90-e79486d54da6',p_request_id=>request_id,p_rows=>rows);
 IF result->>'ok' IS DISTINCT FROM 'true' OR (result->>'count')::integer<>2 THEN RAISE EXCEPTION 'create374_batch_regression: %',result; END IF;
 replay:=public.create_tournament_schedule_batch_v1(p_expected_actor_id=>'675fe35e-60a8-4452-bb90-e79486d54da6',p_request_id=>request_id,p_rows=>rows);
 IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'create374_batch_replay_changed'; END IF;
 PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 result:=public.create_tournament_with_levels_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',
  '{"name":"LOCAL374 ROLLBACK outsider","start_time":"2026-10-24T05:00:00Z","buy_in":100000}',
  '[]'::jsonb,gen_random_uuid(),'11111111-1111-4111-8111-111111111111');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'create374_outsider_allowed'; END IF;
 PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.tournaments WHERE name='LOCAL374 ROLLBACK valid GTD')<>3
 OR EXISTS(SELECT 1 FROM public.tournaments WHERE name LIKE 'LOCAL374 ROLLBACK invalid%')
 OR (SELECT count(DISTINCT coalesce(guarantee_amount::text,'missing')) FROM public.tournaments WHERE name='LOCAL374 ROLLBACK valid GTD')<>3
 THEN RAISE EXCEPTION 'create374_row_invariant_failed'; END IF;
 IF has_function_privilege('anon','public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'create374_acl_broadened'; END IF;
END $$;
SELECT md5(prosrc) AS qualified_create_body FROM pg_proc WHERE oid='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;
ROLLBACK;
