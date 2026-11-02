-- Caller owns transaction. Existing primary finalization216; all probes rollback.
DO $$
DECLARE actor uuid:='675fe35e-60a8-4452-bb90-e79486d54da6';
 final uuid:='4cd3af4d-7e1d-4042-855f-04fb6777e580';
 t public.tournaments; p jsonb; token text; paid_before text;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE final_tournament_id=final
  AND request_id='264bdd6e-33a7-4d7b-837a-e3a6b60a16a6' AND direct_pool_vnd+recorded_overlay_vnd=2500000);
 ASSERT has_function_privilege('authenticated','public.get_tournament_participation_counts_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.get_tournament_participation_counts_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_tournament_participation_counts_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.tournament_tv_pool_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','floor_private.tournament_tv_pool_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.tournament_tv_pool_v1(uuid)','EXECUTE');
 paid_before:=(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb)::text) FROM public.tournament_prize_payments m);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 FOR t IN SELECT * FROM public.tournaments WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' LOOP
  token:='LOCAL-TV220-ROLLBACK-'||gen_random_uuid();
  INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
   VALUES(gen_random_uuid(),t.club_id,token,t.id,'paired');
  PERFORM set_config('role','authenticated',true);
  p:=public.get_tournament_participation_counts_v1(t.id);
  PERFORM set_config('role','none',true);
  ASSERT p->>'tournament_id'=t.id::text AND p ? 'counts';
  ASSERT (p->>'prize_pool')::numeric IS NOT DISTINCT FROM CASE WHEN t.id=final THEN 2500000 ELSE t.prize_pool END;
  ASSERT p->'prize_pool'=public.get_tv_display_state_v4(token,false)->'tournament'->'prize_pool',
   'UUID and capability read must use exactly the same funding calculation';
 END LOOP;
 -- The retained finalized event correctly forbids changing its GTD. Do not
 -- disable that guard to manufacture a test fixture. Different GTD vs funding
 -- is covered at the consumer boundary; SQL helper derives only frozen funding.
 BEGIN
  UPDATE public.tournament_events SET guarantee_amount=3000000 WHERE id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
  RAISE EXCEPTION 'tv220_frozen_gtd_guard_missing';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'main_event_guarantee_frozen' THEN RAISE;END IF;
 END;
 PERFORM set_config('role','authenticated',true);
 p:=public.get_tournament_participation_counts_v1(final);
 ASSERT p->>'prize_pool'='2500000';
 PERFORM set_config('role','none',true);
 -- Foreign/no-role actor may not read either existing summary or helper.
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
 PERFORM set_config('role','authenticated',true);
 BEGIN PERFORM public.get_tournament_participation_counts_v1(final); RAISE EXCEPTION 'tv220_outsider_read_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM floor_private.tournament_tv_pool_v1(final); RAISE EXCEPTION 'tv220_private_helper_exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true);
 BEGIN PERFORM public.get_tournament_participation_counts_v1(final); RAISE EXCEPTION 'tv220_anon_summary_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('role','none',true);
 ASSERT paid_before=(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb)::text) FROM public.tournament_prize_payments m);
 RAISE NOTICE 'TV220_REAL_AUTHORIZED_UUID_CAPABILITY_PARITY_FLIGHTS_FROZEN_GTD_ACTOR_ACL_PASS';
END $$;
