\set ON_ERROR_STOP on
\ir ../financePayrollInstallments/installments.seed.sql
SELECT public.approve_pt_statement_installments_v1(current_setting('test.pt_statement_id')::uuid,
  current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000192','TEST read performance approved budget');
SELECT public.record_pt_statement_installment_v1(current_setting('test.pt_statement_id')::uuid,
  current_setting('test.pt_statement_hash'),2000000,'bank','TEST performance partial receipt',
  '18000000-0000-4000-8000-000000000193','TEST read-only qualification fixture');
RESET ROLE;
UPDATE public.finance_pt_installment_rollout_v1 SET enabled=false;
INSERT INTO auth.users(id)
SELECT ('18000000-0000-4000-8000-'||lpad((200+i)::text,12,'0'))::uuid FROM generate_series(1,20) AS g(i);
INSERT INTO public.club_accountants(club_id,user_id)
SELECT '18000000-0000-4000-8000-000000000001',
 ('18000000-0000-4000-8000-'||lpad((200+i)::text,12,'0'))::uuid FROM generate_series(1,20) AS g(i);
-- Valid synthetic historical operating documents, not proof of a payment writer.
-- 100000 / 12 = 8334 documents in months0..3, 8333 in months4..11.
INSERT INTO public.club_expenses(club_id,category,amount_vnd,description,incurred_at,payment_status,entered_by,idempotency_key)
SELECT '18000000-0000-4000-8000-000000000001','supplies',1000,'TEST read performance document',
 date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
   -interval '11 months'+((i-1)%12)*interval '1 month'+interval '4 days',
 'unpaid','18000000-0000-4000-8000-000000000011','TEST-PERF-'||i::text
FROM generate_series(1,100000) AS g(i);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.club_expenses)<>100000
    OR (SELECT count(DISTINCT to_char(incurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')) FROM public.club_expenses)<>12
    OR (SELECT sum(amount_vnd) FROM public.club_expenses)<>100000000
  THEN RAISE EXCEPTION 'PT_READ_PERFORMANCE_FIXTURE_INVALID'; END IF;
END $$;
COMMIT;
ANALYZE public.club_expenses;
ANALYZE public.dealer_pt_wage_payments;
ANALYZE public.dealer_pt_wage_settlements;
ANALYZE public.dealer_payroll_statements;
