-- LOCAL ONLY: synthetic payroll facts, canonical transitions/report; all changes roll back.
\set ON_ERROR_STOP on
BEGIN;DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
\ir ../migrations/20270128000305_staff_salary_period_serialization_v1.sql
\ir ../migrations/20270128000306_staff_salary_wait_authority_v1.sql
\ir ../migrations/20270128000307_staff_rejected_unpaid_finance_v1.sql
\ir ../migrations/20270128000308_staff_pt_monthly_summary_payment_guard_v1.sql
\ir ../migrations/20270128000309_dealer_rejected_unpaid_finance_v1.sql
INSERT INTO auth.users(id) VALUES('0530eff6-a79a-4db3-b917-8a47de7179c9');INSERT INTO public.profiles(user_id,display_name) VALUES('0530eff6-a79a-4db3-b917-8a47de7179c9','LOCAL TEST reject 0530eff6');
INSERT INTO public.user_roles(user_id,role) VALUES('0530eff6-a79a-4db3-b917-8a47de7179c9','club_admin');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706','0530eff6-a79a-4db3-b917-8a47de7179c9','LOCAL TEST dealer rejection report seeded fixture','TEST','approved');
INSERT INTO public.dealers(id,club_id,full_name) VALUES('e4e82c3c-8911-4f3c-b017-58d6f1e3a0d0','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706','LOCAL TEST seeded payroll dealer');
INSERT INTO public.payroll_periods(id,club_id,period_year,period_month,period_start,period_end,status) VALUES('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706',extract(year from current_date)::int,extract(month from current_date)::int,date_trunc('month',now())::date,(date_trunc('month',now())+interval '1 month - 1 day')::date,'draft');
INSERT INTO public.dealer_payroll(dealer_id,club_id,period_id,employment_type,gross_pay_vnd,net_pay_vnd) VALUES('e4e82c3c-8911-4f3c-b017-58d6f1e3a0d0','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706','1858b0a1-2553-4fac-88b1-91bf02a6e6f4','full_time',100000,100000);
SET LOCAL request.jwt.claim.sub='0530eff6-a79a-4db3-b917-8a47de7179c9';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"0530eff6-a79a-4db3-b917-8a47de7179c9"}';SET LOCAL ROLE authenticated;
SELECT jsonb_build_object('stage','draft','data',public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706'));
SELECT jsonb_build_object('stage','submit','data',public.transition_payroll_status_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','draft','submitted',NULL));
SELECT jsonb_build_object('stage','submitted','data',public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706'));
SELECT jsonb_build_object('stage','reject','data',public.transition_payroll_status_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','submitted','rejected','LOCAL TEST report classification'));
SELECT jsonb_build_object('stage','rejected','data',public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706'));
DO $rejected_assert$ DECLARE r jsonb;BEGIN r:=public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706');ASSERT (r->'cost'->>'payrollNet')::numeric=100000;ASSERT (r->>'unpaidTotal')::numeric=100000;ASSERT (r->'aging'->>'d0_30')::numeric=100000;ASSERT (r->'statusTotals'->>'rejected')::numeric=100000;END $rejected_assert$;
SELECT jsonb_build_object('stage','resubmit','data',public.transition_payroll_status_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','rejected','submitted',NULL));
SELECT jsonb_build_object('stage','resubmitted','data',public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706'));

SELECT public.transition_payroll_status_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','submitted','approved',NULL);
SELECT public.transition_payroll_status_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','approved','locked',NULL);
SELECT public.prepare_payroll_payment_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','LOCAL_TEST','NO REAL CASH');
SELECT jsonb_build_object('stage','prepared','data',public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706'));
SELECT public.mark_payroll_paid_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','LOCAL_TEST',clock_timestamp(),'NO REAL CASH');
SELECT jsonb_build_object('stage','paid','data',public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706'));
DO $repeat$ DECLARE r jsonb;b jsonb;blocked boolean:=false;BEGIN
 SELECT to_jsonb(x) INTO b FROM public.payment_records x WHERE period_id='1858b0a1-2553-4fac-88b1-91bf02a6e6f4';
 BEGIN PERFORM public.mark_payroll_paid_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','SECOND_ATTEMPT',clock_timestamp(),'MUST NOT REWRITE');EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE 'Expected status%';blocked:=true;END;
 ASSERT blocked,'duplicate paid intent unexpectedly succeeded';
 SELECT to_jsonb(x) INTO r FROM public.payment_records x WHERE period_id='1858b0a1-2553-4fac-88b1-91bf02a6e6f4';ASSERT r=b,'repeat changed payment record';
 blocked:=false;
 BEGIN PERFORM public.reconcile_payroll_payment_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','SAME_PAYER','MUST REFUSE');EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE 'Reconciler must be different%';blocked:=true;END;
 ASSERT blocked,'same payer reconciled own payment';
 SELECT to_jsonb(x) INTO r FROM public.payment_records x WHERE period_id='1858b0a1-2553-4fac-88b1-91bf02a6e6f4';ASSERT r=b;
END $repeat$;
RESET ROLE;
INSERT INTO auth.users(id) VALUES('5f4bd158-0edb-44cb-bbfe-7296ebac0208');INSERT INTO public.profiles(user_id,display_name) VALUES('5f4bd158-0edb-44cb-bbfe-7296ebac0208','LOCAL TEST reconcile 5f4bd158');INSERT INTO public.user_roles(user_id,role) VALUES('5f4bd158-0edb-44cb-bbfe-7296ebac0208','club_admin');
SET LOCAL request.jwt.claim.sub='5f4bd158-0edb-44cb-bbfe-7296ebac0208';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"5f4bd158-0edb-44cb-bbfe-7296ebac0208"}';SET LOCAL ROLE authenticated;
SELECT public.reconcile_payroll_payment_secure('1858b0a1-2553-4fac-88b1-91bf02a6e6f4','LOCAL_TEST','NO BANK TRANSFER');
SET LOCAL request.jwt.claim.sub='0530eff6-a79a-4db3-b917-8a47de7179c9';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"0530eff6-a79a-4db3-b917-8a47de7179c9"}';SET LOCAL ROLE authenticated;
SELECT jsonb_build_object('stage','reconciled','data',public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706'));
DO $final$ DECLARE r jsonb;BEGIN
 r:=public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','f1e5dc9b-e6c4-4654-a825-8bc2e1bc2706');ASSERT (r->'cost'->>'payrollNet')::numeric=100000;ASSERT (r->>'unpaidTotal')::numeric=0;ASSERT (r->>'reconciledTotal')::numeric=100000;
 ASSERT(SELECT count(*) FROM public.payment_records WHERE period_id='1858b0a1-2553-4fac-88b1-91bf02a6e6f4')=1;
END $final$;
ROLLBACK;