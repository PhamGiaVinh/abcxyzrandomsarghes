\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND revision=2 AND closed_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND status='announced' AND assignment_id='808821c8-7611-424e-934a-9ce262af139a');
END $$;
CREATE TEMP TABLE close671_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(a)-'current_state'-'updated_at'-'pre_assigned_at'-'pre_assigned_table_id' ORDER BY id) FROM public.dealer_attendance a) payroll_facts,
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m) cash,
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l) chip_ledger;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE plan jsonb; result jsonb; BEGIN
 plan:=public.floor_plan_break_table_v1('4f493b5e-ef25-4e55-bafd-faab24fcade9',2,'fill_lowest_table');
 ASSERT plan->>'ok'='true' AND plan->>'complete'='true' AND jsonb_array_length(plan->'moves')=1,plan::text;
 result:=public.floor_break_table_v5(p_tournament_table_id=>'4f493b5e-ef25-4e55-bafd-faab24fcade9',p_expected_revision=>2,
  p_draw_mode=>'fill_lowest_table',p_request_id=>'381733df-5402-4e27-bb62-536f01abc671',p_plan_hash=>plan->>'plan_hash');
 ASSERT result->>'ok'='true' AND result->>'closed'='true' AND result->>'moved_count'='1',result::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND closed_at IS NOT NULL);
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active AND table_id='c2ce77c0-2b61-4a19-bd43-4752232cc55a');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND status='cancelled'), 'closed Floor session must cancel its announced rotation';
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND current_state='available' AND pre_assigned_at IS NULL AND pre_assigned_table_id IS NULL), 'incoming dealer must not remain reserved for a closed session';
 ASSERT (SELECT payroll_facts=(SELECT jsonb_agg(to_jsonb(a)-'current_state'-'updated_at'-'pre_assigned_at'-'pre_assigned_table_id' ORDER BY id) FROM public.dealer_attendance a) FROM close671_before), 'do not alter payroll/time/rest facts';
 ASSERT (SELECT cash=(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m) AND chip_ledger=(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l) FROM close671_before);
END $$;
ROLLBACK;
SELECT 'SINGLE671_FLOOR_CLOSE_CANCELS_NEXT_RESERVATION_WITHOUT_PAYROLL_CASH_CHIP_CHANGE_PASS';
