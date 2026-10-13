\set ON_ERROR_STOP on
\if :{?coupling_on}
\else
\set coupling_on false
\endif
DO $$ BEGIN IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_database() NOT LIKE 'vinpoker_ops_chip69_%'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'isolated_chip69_runtime_required'; END IF; END $$;

-- Isolated restored current schema only. No fixture function or production connection.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'color_up_test_failed: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('e1600000-0000-4000-8000-000000000001');
INSERT INTO auth.users(id) VALUES('e1600000-0000-4000-8000-000000000099');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e1600000-0000-4000-8000-000000000098','e1600000-0000-4000-8000-000000000099','Other chip TEST','TEST');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e1600000-0000-4000-8000-000000000002','e1600000-0000-4000-8000-000000000001','Chip integrity TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES('e1600000-0000-4000-8000-000000000003','e1600000-0000-4000-8000-000000000002','Color-up TEST','live','playing');
INSERT INTO public.chip_set(id,club_id,name) VALUES('e1600000-0000-4000-8000-000000000004','e1600000-0000-4000-8000-000000000002','TEST set');
INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES
 ('e1600000-0000-4000-8000-000000000005','e1600000-0000-4000-8000-000000000004','e1600000-0000-4000-8000-000000000002',100),
 ('e1600000-0000-4000-8000-000000000006','e1600000-0000-4000-8000-000000000004','e1600000-0000-4000-8000-000000000002',1000),
 ('e1600000-0000-4000-8000-000000000007','e1600000-0000-4000-8000-000000000004','e1600000-0000-4000-8000-000000000002',10000);
INSERT INTO public.tournament_chip_set(tournament_id,chip_set_id,club_id) VALUES('e1600000-0000-4000-8000-000000000003','e1600000-0000-4000-8000-000000000004','e1600000-0000-4000-8000-000000000002');
INSERT INTO public.stack_template(id,tournament_id,club_id,chip_set_id,name,stack_value) VALUES('e1600000-0000-4000-8000-000000000008','e1600000-0000-4000-8000-000000000003','e1600000-0000-4000-8000-000000000002','e1600000-0000-4000-8000-000000000004','TEST stack',1000);
INSERT INTO public.stack_template_line(stack_template_id,denomination_id,count) VALUES('e1600000-0000-4000-8000-000000000008','e1600000-0000-4000-8000-000000000005',10);
INSERT INTO public.chip_bank(club_id,denomination_id,on_hand_count) SELECT 'e1600000-0000-4000-8000-000000000002',id,100 FROM public.chip_set_denomination WHERE chip_set_id='e1600000-0000-4000-8000-000000000004';
SELECT set_config('request.jwt.claim.sub','e1600000-0000-4000-8000-000000000001',true);


CREATE FUNCTION pg_temp.issue69_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('vinpoker.issue69_fault',true)=TG_TABLE_NAME THEN RAISE EXCEPTION 'issuance69_injected_%',TG_TABLE_NAME;END IF;RETURN NEW;END $$;
CREATE TRIGGER zz_issue69_bank_fault BEFORE INSERT ON public.chip_bank_ledger FOR EACH ROW EXECUTE FUNCTION pg_temp.issue69_fault();
CREATE TRIGGER zz_issue69_count_fault BEFORE INSERT OR UPDATE ON public.stack_template_issuance FOR EACH ROW EXECUTE FUNCTION pg_temp.issue69_fault();
CREATE TRIGGER zz_issue69_receipt_fault BEFORE INSERT ON floor_private.chip_mutation_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.issue69_fault();
SET LOCAL ROLE authenticated;
SELECT public.chip_ops_set_bank_coupling('e1600000-0000-4000-8000-000000000002',true);
RESET ROLE;
DO $$ DECLARE point text; result jsonb; before_state jsonb; after_state jsonb; snapshot_sql text; BEGIN
 snapshot_sql:=$snap$SELECT jsonb_build_object(
 'issuance',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.stack_template_id) FROM public.stack_template_issuance i WHERE i.club_id='e1600000-0000-4000-8000-000000000002'),
 'bank',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.denomination_id) FROM public.chip_bank b WHERE b.club_id='e1600000-0000-4000-8000-000000000002'),
 'ledger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.chip_bank_ledger l WHERE l.club_id='e1600000-0000-4000-8000-000000000002'),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.request_key) FROM floor_private.chip_mutation_receipts r WHERE r.actor_id='e1600000-0000-4000-8000-000000000001'))$snap$;
 EXECUTE snapshot_sql INTO before_state;
 FOREACH point IN ARRAY ARRAY['chip_bank_ledger','stack_template_issuance','chip_mutation_receipts'] LOOP
  PERFORM set_config('vinpoker.issue69_fault',point,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN
   result:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',8,0,gen_random_uuid(),'e1600000-0000-4000-8000-000000000001');
   RAISE EXCEPTION 'issuance69_fault_unexpected_success';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM IS DISTINCT FROM 'issuance69_injected_'||point THEN RAISE;END IF;
  END;
  PERFORM set_config('role','none',true);
  PERFORM set_config('vinpoker.issue69_fault','',true);
  EXECUTE snapshot_sql INTO after_state;
  PERFORM pg_temp.assert_true(after_state=before_state,'fault rolls back every issuance/bank/receipt projection: '||point);
 END LOOP;
END $$;
ROLLBACK;
