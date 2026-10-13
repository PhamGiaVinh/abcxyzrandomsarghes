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
SELECT set_config('vinpoker.test_issuance69_coupling', :'coupling_on',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE first_result jsonb; second_result jsonb; replay jsonb; observed jsonb; k uuid:=gen_random_uuid(); k2 uuid:=gen_random_uuid(); BEGIN
 replay:=public.chip_ops_set_bank_coupling('e1600000-0000-4000-8000-000000000002',current_setting('vinpoker.test_issuance69_coupling')::boolean);
 PERFORM pg_temp.assert_true(replay->>'status'='ok','explicit isolated coupling mode');
 first_result:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',8,0,k,'e1600000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(first_result->>'status'='ok' AND (first_result->>'revision')::bigint=1,'first issuance generation');
 second_result:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',9,1,k2,'e1600000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(second_result->>'status'='ok' AND (second_result->>'revision')::bigint=2,'later issuance generation');
 replay:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',8,0,k,'e1600000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(replay=first_result,'same key replay returns original result');
 PERFORM pg_temp.assert_true((SELECT issued_count=9 AND revision=2 FROM public.stack_template_issuance WHERE stack_template_id='e1600000-0000-4000-8000-000000000008'),'stale retry preserves later count');
 replay:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',7,0,k,'e1600000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(replay->>'error'='IDEMPOTENCY_CONFLICT','changed payload conflicts');
 observed:=public.get_chip_issuance_receipt_v1('e1600000-0000-4000-8000-000000000008',8,0,k,'e1600000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(observed->'result'=first_result,'read-only receipt recovers unknown outcome');
 replay:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',8,0,gen_random_uuid(),'e1600000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(replay->>'error'='STALE_STATE','new key with old generation denied');
 replay:=public.chip_ops_set_issuance('e1600000-0000-4000-8000-000000000008',8);
 PERFORM pg_temp.assert_true(replay->>'error'='EXACT_ISSUANCE_INTENT_REQUIRED','legacy cannot bypass CAS');
 PERFORM pg_temp.assert_true((SELECT current_count=90 FROM public.chip_ops_current_denom_counts('e1600000-0000-4000-8000-000000000003') WHERE denomination_id='e1600000-0000-4000-8000-000000000005'),'current inventory matches nine stacks');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_true((SELECT on_hand_count=CASE WHEN current_setting('vinpoker.test_issuance69_coupling')::boolean THEN 10 ELSE 100 END
   FROM public.chip_bank WHERE club_id='e1600000-0000-4000-8000-000000000002' AND denomination_id='e1600000-0000-4000-8000-000000000005'),'bank movement matches accepted coupling');
 PERFORM pg_temp.assert_true((SELECT count(*)=CASE WHEN current_setting('vinpoker.test_issuance69_coupling')::boolean THEN 2 ELSE 0 END
   FROM public.chip_bank_ledger WHERE ref_type='stack_template' AND ref_id='e1600000-0000-4000-8000-000000000008'),'replay and stale rejection add no bank ledger');
 PERFORM set_config('role','authenticated',true);
 replay:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',10,2,gen_random_uuid(),'e1600000-0000-4000-8000-000000000099');
 PERFORM pg_temp.assert_true(replay->>'error'='ACTOR_MISMATCH','client actor cannot replace JWT actor');
 PERFORM set_config('request.jwt.claim.sub','e1600000-0000-4000-8000-000000000099',true);
 replay:=public.get_chip_issuance_state_v1('e1600000-0000-4000-8000-000000000008','e1600000-0000-4000-8000-000000000099');
 PERFORM pg_temp.assert_true(replay->>'error'='Forbidden','owner of different club cannot read issuance');
 replay:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',10,2,gen_random_uuid(),'e1600000-0000-4000-8000-000000000099');
 PERFORM pg_temp.assert_true(replay->>'error'='Forbidden','owner of different club cannot issue');
 PERFORM set_config('request.jwt.claim.sub','e1600000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','none',true);
 UPDATE public.clubs SET owner_id=NULL WHERE id='e1600000-0000-4000-8000-000000000002';
 PERFORM set_config('role','authenticated',true);
 replay:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',8,0,k,'e1600000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(replay->>'error'='Forbidden','revoked actor cannot replay old receipt');
 replay:=public.get_chip_issuance_receipt_v1('e1600000-0000-4000-8000-000000000008',8,0,k,'e1600000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true(replay->>'error'='Forbidden','revoked actor cannot reconcile old receipt');
END $$;
RESET ROLE;
ROLLBACK;
