\set ON_ERROR_STOP on
-- Isolated restored current schema only. No fixture function or production connection.
BEGIN;
\if :{?EXACT_ISSUANCE_CASE}
SELECT set_config('vinpoker.test_colorup_exact_issuance','true',true);
\else
SELECT set_config('vinpoker.test_colorup_exact_issuance','false',true);
\endif
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
DO $$ DECLARE first_result jsonb; retry jsonb; second_result jsonb; r jsonb; BEGIN
  IF current_setting('vinpoker.test_colorup_exact_issuance')::boolean THEN
    r:=public.chip_ops_set_issuance('e1600000-0000-4000-8000-000000000008',1);
    PERFORM pg_temp.assert_true(r->>'error'='EXACT_ISSUANCE_INTENT_REQUIRED','retired issuance cannot bypass exact intent');
    r:=public.chip_ops_set_issuance_v2('e1600000-0000-4000-8000-000000000008',1,0,
      'e1600000-0000-4000-8000-000000000069','e1600000-0000-4000-8000-000000000001');
  ELSE
    r:=public.chip_ops_set_issuance('e1600000-0000-4000-8000-000000000008',1);
  END IF;
  PERFORM pg_temp.assert_true(r->>'status'='ok','issuance succeeds on actual tables');
  r:=public.chip_ops_set_bank_coupling('e1600000-0000-4000-8000-000000000002',true);
  PERFORM pg_temp.assert_true(r->>'status'='ok','TEST coupling enabled');
  first_result:=public.chip_ops_color_up('e1600000-0000-4000-8000-000000000003','e1600000-0000-4000-8000-000000000005','e1600000-0000-4000-8000-000000000006',1,1,'current-schema-first');
  PERFORM pg_temp.assert_true(first_result->>'status'='ok','coupled color-up commits');
  retry:=public.chip_ops_color_up('e1600000-0000-4000-8000-000000000003','e1600000-0000-4000-8000-000000000005','e1600000-0000-4000-8000-000000000006',1,1,'current-schema-first');
  PERFORM pg_temp.assert_true(retry=first_result,'lost response returns identical receipt');
  retry:=public.chip_ops_color_up('e1600000-0000-4000-8000-000000000003','e1600000-0000-4000-8000-000000000005','e1600000-0000-4000-8000-000000000006',2,1,'current-schema-first');
  PERFORM pg_temp.assert_true(retry->>'error'='IDEMPOTENCY_CONFLICT','changed payload rejected');
  second_result:=public.chip_ops_color_up('e1600000-0000-4000-8000-000000000003','e1600000-0000-4000-8000-000000000006','e1600000-0000-4000-8000-000000000007',0,2,'current-schema-second');
  PERFORM pg_temp.assert_true(second_result->>'status'='ok','second color-up in same transaction');
  r:=public.chip_ops_reverse_color_up((first_result->>'color_up_operation_id')::uuid,'current-schema-undo-first');
  PERFORM pg_temp.assert_true(r->>'error'='UNDO_DEPENDENCY','later color-up must undo first');
  r:=public.chip_ops_set_bank_coupling('e1600000-0000-4000-8000-000000000002',false);
  r:=public.chip_ops_reverse_color_up((second_result->>'color_up_operation_id')::uuid,'current-schema-undo-second');
  PERFORM pg_temp.assert_true(r->>'status'='ok' AND (r->>'bank_reversed')::boolean,'undo honors original coupling even after toggle OFF');
  r:=public.chip_ops_reverse_color_up((first_result->>'color_up_operation_id')::uuid,'current-schema-undo-first');
  PERFORM pg_temp.assert_true(r->>'status'='ok','reverse dependency order succeeds');
  PERFORM pg_temp.assert_true((SELECT current_count=10 FROM public.chip_ops_current_denom_counts('e1600000-0000-4000-8000-000000000003') WHERE denomination_id='e1600000-0000-4000-8000-000000000005'),'original floor inventory restored');
  PERFORM pg_temp.assert_true((SELECT bool_and(on_hand_count=100) FROM public.chip_bank WHERE club_id='e1600000-0000-4000-8000-000000000002'),'original bank inventory restored');
  PERFORM pg_temp.assert_true((public.get_current_chip_inventory('e1600000-0000-4000-8000-000000000003')->>'reconciled')::boolean,'ledger reconciles');
  r:=public.chip_ops_bank_sync('e1600000-0000-4000-8000-000000000002',
    '[{"denomination_id":"e1600000-0000-4000-8000-000000000005","total":110},{"denomination_id":"e1600000-0000-4000-8000-000000000006","total":100}]'::jsonb);
  PERFORM pg_temp.assert_true(r->>'status'='ok','bank sync uses current scoped inventory');
  r:=public.chip_ops_bank_adjust('e1600000-0000-4000-8000-000000000002','e1600000-0000-4000-8000-000000000005',
    'thu',1,'e1600000-0000-4000-8000-000000000003',
    (SELECT version FROM public.chip_bank WHERE club_id='e1600000-0000-4000-8000-000000000002' AND denomination_id='e1600000-0000-4000-8000-000000000005'),'current-schema-bank-adjust');
  PERFORM pg_temp.assert_true(r->>'status'='ok','bank adjustment works with shared lock');
END $$;
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','floor_private.chip_mutation_receipts','SELECT'),'receipts remain internal');
SELECT set_config('request.jwt.claim.sub','e1600000-0000-4000-8000-000000000099',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.chip_ops_current_denom_counts('e1600000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'outsider must not read inventory helper';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
