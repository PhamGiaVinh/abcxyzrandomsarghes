BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c19ee5c2-68c7-4627-842a-06a3a2348d6f' AND name='Tour edit121 partial local TEST config committed')
 THEN RAISE EXCEPTION 'edit201_fixture_guard';END IF;
END $$;
SELECT set_config('test.edit201_key',gen_random_uuid()::text,true);
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE context jsonb;cfg jsonb;r jsonb;receipt jsonb;levels jsonb;
BEGIN
 context:=public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid());
 IF context->>'ok'<>'true' OR context->>'can_edit_blinds'<>'true' THEN RAISE EXCEPTION 'edit201_context %',context;END IF;
 PERFORM set_config('test.edit201_before',(context->'state')::text,true);
 cfg:=(context#>'{state,config}')||'{"name":"TEST edit201 atomic","guarantee_amount":null}';
 levels:='[{"level_number":1,"small_blind":300,"big_blind":600,"ante":0,"duration_minutes":25,"is_break":false}]';
 r:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',context->'state',cfg,levels,current_setting('test.edit201_key')::uuid,auth.uid());
 IF r->>'ok'<>'true' OR r#>>'{state,config,name}'<>'TEST edit201 atomic'
 OR jsonb_array_length(r#>'{state,levels}')<>1 OR r#>>'{state,levels,0,big_blind}'<>'600' THEN RAISE EXCEPTION 'edit201_write %',r;END IF;
 receipt:=public.get_tournament_edit_receipt_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',context->'state',cfg,levels,current_setting('test.edit201_key')::uuid,auth.uid());
 IF receipt IS DISTINCT FROM r THEN RAISE EXCEPTION 'edit201_read_receipt';END IF;
 receipt:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',context->'state',cfg,levels,current_setting('test.edit201_key')::uuid,auth.uid());
 IF receipt IS DISTINCT FROM r THEN RAISE EXCEPTION 'edit201_replay';END IF;
 receipt:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',context->'state',cfg||'{"name":"wrong payload"}',levels,current_setting('test.edit201_key')::uuid,auth.uid());
 IF receipt->>'error'<>'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'edit201_conflict %',receipt;END IF;
 receipt:=public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',context->'state',cfg,levels,gen_random_uuid(),auth.uid());
 IF receipt->>'error'<>'stale_edit_context' THEN RAISE EXCEPTION 'edit201_stale %',receipt;END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'EDIT201_REAL_CONTEXT_ATOMIC_CONFIG_LEVELS_RECEIPT_REPLAY_PAYLOAD_CONFLICT_STALE_DENIAL_ROLLBACK';
