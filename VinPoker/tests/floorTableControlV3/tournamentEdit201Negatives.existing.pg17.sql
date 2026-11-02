BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c19ee5c2-68c7-4627-842a-06a3a2348d6f' AND name='Tour edit121 partial local TEST config committed')
 THEN RAISE EXCEPTION 'edit201_negative_fixture_guard';END IF;
END $$;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE c jsonb;cfg jsonb;r jsonb;k uuid;bad jsonb;expected text;
BEGIN
 c:=public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid());
 IF c->>'ok'<>'true' THEN RAISE EXCEPTION 'owner_context_required %',c;END IF;
 PERFORM set_config('test.edit201_negative_state',(c->'state')::text,true);
 cfg:=c#>'{state,config}';
 r:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',c->'state',cfg,NULL,gen_random_uuid(),'a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec');
 IF r->>'error'<>'actor_changed' THEN RAISE EXCEPTION 'expected_actor_binding %',r;END IF;
 r:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',gen_random_uuid(),c->'state',cfg,NULL,gen_random_uuid(),auth.uid());
 IF r->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'cross_club_expected_authority_denial %',r;END IF;
 FOR bad,expected IN SELECT * FROM (VALUES
   (cfg||'{"buy_in":-1}'::jsonb,'invalid_edit_number'),
   (cfg||'{"starting_stack":0}'::jsonb,'invalid_edit_number'),
   (cfg||'{"buy_in":1.5}'::jsonb,'invalid_edit_number'),
   (cfg||'{"unexpected":1}'::jsonb,'invalid_edit_fields')) AS v(payload,error_code)
 LOOP
   k:=gen_random_uuid();
   r:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',c->'state',bad,NULL,k,auth.uid());
   IF r->>'error' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'invalid_config_expected_%_got_%',expected,r;END IF;
   r:=public.get_tournament_edit_receipt_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',c->'state',bad,NULL,k,auth.uid());
   IF r->>'ok'='true' THEN RAISE EXCEPTION 'invalid_config_receipt';END IF;
 END LOOP;
 r:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',c->'state',cfg,'[]',gen_random_uuid(),auth.uid());
 IF r->>'error'<>'invalid_blind_levels' THEN RAISE EXCEPTION 'empty_blind_replacement %',r;END IF;
 IF public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid())->'state' IS DISTINCT FROM c->'state'
 THEN RAISE EXCEPTION 'negative_changed_context';END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"a6b9e3c6-ce29-4ce9-851b-b3e7a8698dec"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE s jsonb;r jsonb;BEGIN
 s:=current_setting('test.edit201_negative_state')::jsonb;
 r:=public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid());
 IF r->>'error'<>'actor_not_allowed' THEN RAISE EXCEPTION 'outsider_context %',r;END IF;
 r:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',s,s->'config',NULL,gen_random_uuid(),auth.uid());
 IF r->>'error'<>'actor_not_allowed' THEN RAISE EXCEPTION 'outsider_write %',r;END IF;
END $$;
RESET ROLE;
SELECT set_config('test.edit201_admin',gen_random_uuid()::text,true);
INSERT INTO auth.users(id) VALUES(current_setting('test.edit201_admin')::uuid);
INSERT INTO public.user_roles(user_id,role) VALUES(current_setting('test.edit201_admin')::uuid,'super_admin');
SELECT set_config('request.jwt.claim.sub',current_setting('test.edit201_admin'),true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('test.edit201_admin'))::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c jsonb;r jsonb;cfg jsonb;BEGIN
 c:=public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid());
 IF c->>'ok' IS DISTINCT FROM 'true' OR c->>'can_edit_blinds' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'admin_nonmember_context_authority %',c;END IF;
 cfg:=(c#>'{state,config}')||'{"name":"TEST admin201 config only"}';
 r:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',c->'state',cfg,
 '[{"level_number":1,"small_blind":100,"big_blind":200,"ante":0,"duration_minutes":20,"is_break":false}]',gen_random_uuid(),auth.uid());
 IF r->>'error' IS DISTINCT FROM 'blind_levels_not_allowed' THEN RAISE EXCEPTION 'admin_blind_escalation %',r;END IF;
 r:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',c->'state',cfg,NULL,gen_random_uuid(),auth.uid());
 IF r->>'ok' IS DISTINCT FROM 'true' OR r#>>'{state,config,name}'<>'TEST admin201 config only'
 OR r#>'{state,levels}' IS DISTINCT FROM c#>'{state,levels}' THEN RAISE EXCEPTION 'admin_config_only_preserve_blinds %',r;END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'EDIT201_ACTOR_CLUB_INVALID_CONFIG_EMPTY_LEVELS_OUTSIDER_ADMIN_CONFIG_WITHOUT_BLIND_ESCALATION_ROLLBACK_PASS';
