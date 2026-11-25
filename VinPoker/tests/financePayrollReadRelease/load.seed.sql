\set ON_ERROR_STOP on
SET statement_timeout='300s';
DO $$ BEGIN
  IF current_database()<>'vinpoker_ops_pt_read_release_load' OR EXISTS(SELECT FROM public.clubs) THEN
    RAISE EXCEPTION 'empty_isolated_read_load_database_required';END IF;
  IF to_regclass('public.finance_pt_installment_plans_v1') IS NOT NULL THEN
    RAISE EXCEPTION 'original_schema_only_no_installment_foundation';END IF;
END $$;
INSERT INTO auth.users(id) VALUES('18000000-0000-4000-8000-000000000011');
INSERT INTO public.profiles(user_id,display_name) VALUES('18000000-0000-4000-8000-000000000011','Synthetic read load owner');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('18000000-0000-4000-8000-000000000001',
 '18000000-0000-4000-8000-000000000011','Isolated read-volume fixture','TEST','approved');
INSERT INTO auth.users(id) SELECT ('18000000-0000-4000-8000-'||lpad((201+i)::text,12,'0'))::uuid FROM generate_series(0,19) i;
INSERT INTO public.profiles(user_id,display_name) SELECT ('18000000-0000-4000-8000-'||lpad((201+i)::text,12,'0'))::uuid,
 'Synthetic read recipient '||i FROM generate_series(0,19) i;
SET request.jwt.claim.sub='18000000-0000-4000-8000-000000000011';
INSERT INTO public.dealers(id,club_id,user_id,full_name,status,employment_type,hourly_rate_vnd)
 SELECT ('18000000-0000-4000-8000-'||lpad((301+i)::text,12,'0'))::uuid,'18000000-0000-4000-8000-000000000001',
 ('18000000-0000-4000-8000-'||lpad((201+i)::text,12,'0'))::uuid,'Synthetic read recipient '||i,'active','part_time',50000
 FROM generate_series(0,19) i;
INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by)
 SELECT id,50000,true,'2026-11-01T00:00:00+07:00','18000000-0000-4000-8000-000000000011' FROM public.dealers;
INSERT INTO public.dealer_attendance(dealer_id,shift_date,status,current_state,check_in_time,check_out_time)
 SELECT d.id,day::date,'checked_out','checked_out',day::timestamptz+interval '8 hours',day::timestamptz+interval '28 hours'
 FROM public.dealers d CROSS JOIN generate_series('2026-11-01'::date,'2026-11-05'::date,interval '1 day') AS days(day);
SET ROLE authenticated;
DO $$ DECLARE i int; frozen jsonb; paid jsonb; BEGIN
  FOR i IN 0..19 LOOP
    frozen:=public.finalize_part_time_payroll_statement(
      ('18000000-0000-4000-8000-'||lpad((3001+i)::text,12,'0'))::uuid,'18000000-0000-4000-8000-000000000001',
      ('18000000-0000-4000-8000-'||lpad((301+i)::text,12,'0'))::uuid,'Synthetic read-load real legacy reference');
    IF frozen->>'net_amount_vnd' IS DISTINCT FROM '5000000' THEN RAISE EXCEPTION 'reference_not_real_five_million';END IF;
    paid:=public.pay_finalized_part_time_payroll_statement((frozen->>'statement_id')::uuid,'bank','TEST load reference',
      ('18000000-0000-4000-8000-'||lpad((4001+i)::text,12,'0')),'Synthetic read fixture, not production');
    IF paid->>'amount_vnd' IS DISTINCT FROM '5000000' THEN RAISE EXCEPTION 'reference_not_canonical_full_payment';END IF;
  END LOOP;
END $$;
RESET ROLE;
-- 20 actual legacy references establish valid payload shape and self identity.
-- The remaining99980 rows are SYNTHETIC READ-VOLUME CLONES, not independently
-- finalized obligations, historical accounting evidence or chronological forecasts.
CREATE TEMP TABLE load_references AS SELECT s.id,row_number() OVER(ORDER BY s.dealer_id) ordinal
 FROM public.dealer_payroll_statements s;
CREATE TEMP TABLE load_clone_map AS SELECT r.id reference_id,
 ('28000000-0000-4000-8000-'||lpad(((r.ordinal-1)*4999+j)::text,12,'0'))::uuid id,
 ('29000000-0000-4000-8000-'||lpad(((r.ordinal-1)*4999+j)::text,12,'0'))::uuid request_id,
 date_trunc('month',now())-(1+j%11)*interval '1 month'+j*interval '1 millisecond' display_time
 FROM load_references r CROSS JOIN generate_series(1,4999) j;
INSERT INTO public.dealer_payroll_statements SELECT (jsonb_populate_record(NULL::public.dealer_payroll_statements,
 to_jsonb(s)||jsonb_build_object('id',m.id,'request_id',m.request_id,'pt_wage_payment_id',NULL,'finalized_at',m.display_time))).*
 FROM load_clone_map m JOIN public.dealer_payroll_statements s ON s.id=m.reference_id;
INSERT INTO public.dealer_payroll_statement_lines(statement_id,line_no,line_type,line_code,label,quantity,unit,unit_rate_vnd,amount_vnd,source_snapshot,created_at)
 SELECT m.id,l.line_no,l.line_type,l.line_code,l.label,l.quantity,l.unit,l.unit_rate_vnd,l.amount_vnd,l.source_snapshot,l.created_at
 FROM load_clone_map m JOIN public.dealer_payroll_statement_lines l ON l.statement_id=m.reference_id;
ANALYZE public.dealer_payroll_statements;
ANALYZE public.dealer_payroll_statement_lines;
ANALYZE public.dealer_pt_wage_payments;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.dealer_payroll_statements) IS DISTINCT FROM 100000
  OR (SELECT count(*) FROM public.dealer_payroll_statement_lines) IS DISTINCT FROM 500000
  OR (SELECT count(DISTINCT date_trunc('month',finalized_at)) FROM public.dealer_payroll_statements) IS DISTINCT FROM 12
  OR (SELECT count(*) FROM public.dealer_pt_wage_payments) IS DISTINCT FROM 20 THEN
   RAISE EXCEPTION 'read_load_shape_wrong';END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_index WHERE indexrelid='public.dealer_pt_wage_payments_statement_uq'::regclass AND indisunique) THEN
   RAISE EXCEPTION 'legacy_full_payment_index_changed';END IF;
END $$;
SELECT 'PT_STANDALONE_READ_VOLUME_100000_STATEMENTS_500000_LINES_20_SELF_12_DISPLAY_MONTHS_READY' result;
