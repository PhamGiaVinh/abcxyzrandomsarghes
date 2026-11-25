\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database()<>'vinpoker_ops_pt_installment' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
  IF EXISTS(SELECT FROM public.clubs) OR EXISTS(SELECT FROM public.dealer_pt_wage_payments) THEN
    RAISE EXCEPTION 'empty_schema_restore_required';
  END IF;
END $$;
INSERT INTO auth.users(id) VALUES ('18000000-0000-4000-8000-000000000011');
INSERT INTO public.profiles(user_id,display_name) VALUES ('18000000-0000-4000-8000-000000000011','PT installment TEST owner');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','PT installment TEST','TEST','approved');
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000011';
INSERT INTO public.dealers(id,club_id,full_name,status,employment_type,hourly_rate_vnd) VALUES
 ('18000000-0000-4000-8000-000000000051','18000000-0000-4000-8000-000000000001','PT installment TEST dealer','active','part_time',50000);
INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by) VALUES
 ('18000000-0000-4000-8000-000000000051',50000,true,'2026-11-01T00:00:00+07:00','18000000-0000-4000-8000-000000000011');
INSERT INTO public.dealer_attendance(dealer_id,shift_date,status,current_state,check_in_time,check_out_time)
SELECT '18000000-0000-4000-8000-000000000051',day::date,'checked_out','checked_out',
 day::timestamptz+interval '8 hours',day::timestamptz+interval '28 hours'
FROM generate_series('2026-11-01'::date,'2026-11-05'::date,interval '1 day') AS days(day);

DO $$ BEGIN
  IF to_regprocedure('public.record_pt_statement_installment_v1(uuid,text,bigint,text,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_REQUIRED_BEHAVIOR_MISSING: cannot pay 2M then 3M against one immutable 5M statement';
  END IF;
END $$;
INSERT INTO public.finance_pt_installment_rollout_v1(club_id,enabled)
VALUES ('18000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f jsonb; BEGIN
  f:=public.finalize_part_time_payroll_statement('18000000-0000-4000-8000-000000000091',
    '18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000051','TEST immutable 5M installments');
  IF f->>'net_amount_vnd' IS DISTINCT FROM '5000000' THEN RAISE EXCEPTION 'fixture_not_five_million'; END IF;
  PERFORM set_config('test.pt_statement_id',f->>'statement_id',true);
END $$;
RESET ROLE;
CREATE TEMP TABLE pt_statement_before AS SELECT to_jsonb(s) snapshot FROM public.dealer_payroll_statements s
WHERE id=current_setting('test.pt_statement_id')::uuid;
SELECT set_config('test.pt_statement_hash',statement_hash,true) FROM public.dealer_payroll_statements
WHERE id=current_setting('test.pt_statement_id')::uuid;
SET LOCAL ROLE authenticated;
