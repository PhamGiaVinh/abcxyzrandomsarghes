-- LOCAL ONLY: requires the retained closed real-clock PT fixture; payment and DDL roll back.
-- This is native PostgreSQL business authorization, not hosted signed Auth.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN ASSERT current_database()='vinpoker_owner_ft_reports_20261031';ASSERT current_setting('port')='55441';ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_OWNER_FT_REPORTS_20261031_OWNED_LOCAL_TEST';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT NOT(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role');END $$;
\ir ../migrations/20270128000304_fnb_cancel_snapshot_cost_v1.sql
\ir ../migrations/20270128000305_staff_salary_period_serialization_v1.sql
\ir ../migrations/20270128000306_staff_salary_wait_authority_v1.sql
\ir ../migrations/20270128000307_staff_rejected_unpaid_finance_v1.sql
\ir ../migrations/20270128000308_staff_pt_monthly_summary_payment_guard_v1.sql
SELECT set_config('request.jwt.claim.sub','dd282d3b-3e59-4beb-a593-824242b99cd8',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"dd282d3b-3e59-4beb-a593-824242b99cd8"}',true);
SET LOCAL ROLE authenticated;
DO $pt_assert$
DECLARE d jsonb;r jsonb;b jsonb;a jsonb;m jsonb;y int:=extract(year from current_date)::int;mo int:=extract(month from current_date)::int;
BEGIN
 d:=public.pay_staff_pt_balance('7831fbf0-22fe-4273-9919-09e653fe24b2','LOCAL_TEST','ROLLBACK_ONLY',gen_random_uuid()::text,'LOCAL TEST PT monthly regression');
 ASSERT d->>'error' IS NULL,d::text;
 ASSERT (d->>'amount_vnd')::numeric>0,d::text;
 r:=public.chot_staff_salary_month('08dcf2b8-6041-48c3-9f2c-22007a1e5efa',y,mo);ASSERT r->>'error' IS NULL,r::text;
 r:=public.submit_staff_salary_month('08dcf2b8-6041-48c3-9f2c-22007a1e5efa',y,mo,'LOCAL TEST rollback');ASSERT r->>'error' IS NULL,r::text;
 r:=public.approve_staff_salary_month('08dcf2b8-6041-48c3-9f2c-22007a1e5efa',y,mo);ASSERT r->>'error' IS NULL,r::text;
 b:=public.get_staff_salary_report('08dcf2b8-6041-48c3-9f2c-22007a1e5efa',y,mo);
 ASSERT jsonb_array_length(b->'rows')=1,b::text;
 ASSERT b->'rows'->0->>'employment_type'='part_time',b::text;
 ASSERT b->'rows'->0->>'status'='locked',b::text;
 ASSERT (b->'rows'->0->>'net_vnd')::numeric=(d->>'amount_vnd')::numeric,b::text;
 m:=public.mark_staff_salary_paid((b->'rows'->0->>'id')::uuid,'LOCAL_TEST','MUST_REFUSE');
 ASSERT m->>'error'='PT_MONTHLY_PAYMENT_SUMMARY_ONLY',m::text;
 a:=public.get_staff_salary_report('08dcf2b8-6041-48c3-9f2c-22007a1e5efa',y,mo);
 ASSERT a->'rows'=b->'rows',a::text;
 r:=public.get_club_finance_summary(date_trunc('month',now()),clock_timestamp()+interval '1 second','08dcf2b8-6041-48c3-9f2c-22007a1e5efa');
 ASSERT (r->'cost'->>'ptWagePaid')::numeric=(d->>'amount_vnd')::numeric,r::text;
 ASSERT (r->>'unpaidTotal')::numeric=0,r::text;
END $pt_assert$;
ROLLBACK;

