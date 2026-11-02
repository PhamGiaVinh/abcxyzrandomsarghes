BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c19ee5c2-68c7-4627-842a-06a3a2348d6f' AND name='Tour edit121 partial local TEST config committed')
 OR to_regprocedure('public.test_edit201_fault()') IS NOT NULL THEN RAISE EXCEPTION 'edit201_fault_scope';END IF;
END $$;
CREATE FUNCTION public.test_edit201_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tournament_id='c19ee5c2-68c7-4627-842a-06a3a2348d6f'::uuid THEN RAISE EXCEPTION 'TEST_EDIT201_LEVEL_FAILURE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_edit201_fault BEFORE INSERT ON public.tournament_levels FOR EACH ROW EXECUTE FUNCTION public.test_edit201_fault();
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='f793a5b3-6025-4766-bc1b-49f16aa1b44a';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"f793a5b3-6025-4766-bc1b-49f16aa1b44a"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE ctx jsonb;cfg jsonb;levels jsonb;key uuid:=gen_random_uuid();r jsonb;after_ctx jsonb;
BEGIN
 ctx:=public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid());
 cfg:=(ctx#>'{state,config}')||'{"name":"TEST must roll back this parent"}';
 levels:='[{"level_number":1,"small_blind":500,"big_blind":1000,"ante":0,"duration_minutes":20,"is_break":false}]';
 BEGIN
  PERFORM public.edit_tournament_with_levels_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',ctx->'state',cfg,levels,key,auth.uid());
  RAISE EXCEPTION 'edit201_fault_not_observed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TEST_EDIT201_LEVEL_FAILURE' THEN RAISE;END IF;END;
 after_ctx:=public.get_tournament_edit_context_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f',auth.uid());
 IF after_ctx->'state' IS DISTINCT FROM ctx->'state' THEN RAISE EXCEPTION 'edit201_partial_state_survived_fault';END IF;
 r:=public.get_tournament_edit_receipt_v1('c19ee5c2-68c7-4627-842a-06a3a2348d6f','8e5239a5-36f2-4a0b-a0a3-cb7a236f51b2',ctx->'state',cfg,levels,key,auth.uid());
 IF r->>'error'<>'receipt_not_found' THEN RAISE EXCEPTION 'edit201_receipt_survived_failed_transaction';END IF;
 -- This is proven PostgreSQL rollback, not using a missing receipt to infer
 -- rollback after a merely lost HTTP response.
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'EDIT201_ACTUAL_BLIND_INSERT_FAILURE_ROLLS_BACK_PARENT_LEVELS_AUDIT_AND_RECEIPT';
