\set ON_ERROR_STOP on
DO $$ BEGIN IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_database() NOT LIKE 'vinpoker_ops_chip69_%'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'isolated_chip69_runtime_required'; END IF; END $$;

-- Isolated restored current schema only. No fixture function or production connection.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'color_up_test_failed: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('e1600000-0000-4000-8000-000000000001');
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
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.chip_ops_set_bank_coupling('e1600000-0000-4000-8000-000000000002',false);
 PERFORM pg_temp.assert_true(r->>'status'='ok','isolated coupling OFF');
 r:=public.chip_ops_set_issuance('e1600000-0000-4000-8000-000000000008',8);
 PERFORM pg_temp.assert_true(r->>'status'='ok','first operator issues eight');
 r:=public.chip_ops_set_issuance('e1600000-0000-4000-8000-000000000008',9);
 PERFORM pg_temp.assert_true(r->>'status'='ok','later operator issues nine');
 -- The first operator retries after losing its response. Serialization alone
 -- must not authorize overwriting the intervening issue generation.
 r:=public.chip_ops_set_issuance('e1600000-0000-4000-8000-000000000008',8);
 PERFORM pg_temp.assert_true((SELECT issued_count=9 FROM public.stack_template_issuance
  WHERE stack_template_id='e1600000-0000-4000-8000-000000000008'),
  'ISSUANCE_STALE_RETRY_OVERWRITES_LATER_COUNT');
END $$;
RESET ROLE;
ROLLBACK;
