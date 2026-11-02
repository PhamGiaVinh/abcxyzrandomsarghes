import assert from 'node:assert/strict';
export function verifyPredictionScope(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const club='349ecf35-50ba-4c71-a581-15dc45f1cd01',actor='a364de8e-06b1-4428-a20d-ac614ec406e5';
 assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.clubs WHERE id='${club}' AND owner_id='${actor}' AND name='Cash identity local TEST');`),'t');
 const before=sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)::text) FROM public.dealer_assignments a JOIN public.game_tables t ON t.id=a.table_id WHERE t.club_id='${club}';`);
 const counts=sql('SELECT (SELECT count(*) FROM auth.users)||\'|\'||(SELECT count(*) FROM public.club_dealer_controls);');
 const result=sql(`BEGIN;SET LOCAL statement_timeout='5s';
 DO $test$ DECLARE rpc text; outsider uuid:=gen_random_uuid(); controller uuid:=gen_random_uuid();BEGIN
 INSERT INTO auth.users(id) VALUES(outsider),(controller);
 INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES('${club}',controller);
 FOREACH rpc IN ARRAY ARRAY['get_table_assignments_with_next','predict_next_dealers'] LOOP
  PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claim.role','anon',true);
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);PERFORM set_config('role','anon',true);
  BEGIN EXECUTE format('SELECT count(*) FROM public.%I($1)',rpc) USING '${club}'::uuid;
   RAISE EXCEPTION 'prediction_anonymous_read_not_denied';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  PERFORM set_config('role','none',true);
  -- A forged JWT role must not turn an authenticated outsider into service.
  PERFORM set_config('request.jwt.claim.sub',outsider::text,true);PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','service_role')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN EXECUTE format('SELECT count(*) FROM public.%I($1)',rpc) USING '${club}'::uuid;
   RAISE EXCEPTION 'prediction_outsider_read_not_denied';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  PERFORM set_config('role','none',true);
  PERFORM set_config('request.jwt.claim.sub','${actor}',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);PERFORM set_config('role','authenticated',true);
  EXECUTE format('SELECT count(*) FROM public.%I($1)',rpc) USING '${club}'::uuid;
  BEGIN EXECUTE format('SELECT count(*) FROM public.%I($1)',rpc) USING '00000000-0000-4000-8000-000000000099'::uuid;
   RAISE EXCEPTION 'prediction_other_club_read_not_denied';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  PERFORM set_config('role','none',true);
  PERFORM set_config('request.jwt.claim.sub',controller::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',controller,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  EXECUTE format('SELECT count(*) FROM public.%I($1)',rpc) USING '${club}'::uuid;
  PERFORM set_config('role','none',true);
  PERFORM set_config('role','service_role',true);
  EXECUTE format('SELECT count(*) FROM public.%I($1)',rpc) USING '${club}'::uuid;
  PERFORM set_config('role','none',true);
 END LOOP;
 END $test$;
 SELECT 'PREDICTION_BOTH_RPC_ACTOR_TENANT_ANON_SERVICE_PASS';ROLLBACK;`);
 assert.equal(result,'PREDICTION_BOTH_RPC_ACTOR_TENANT_ANON_SERVICE_PASS');
 assert.equal(sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)::text) FROM public.dealer_assignments a JOIN public.game_tables t ON t.id=a.table_id WHERE t.club_id='${club}';`),before);
 assert.equal(sql('SELECT (SELECT count(*) FROM auth.users)||\'|\'||(SELECT count(*) FROM public.club_dealer_controls);'),counts);
 console.log('PREDICTION_SCOPE_NATIVE_ROLLBACK_NO_ASSIGNMENT_DELTA_PASS');
}
