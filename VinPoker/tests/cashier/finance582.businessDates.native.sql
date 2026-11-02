-- Exact local contract/ACL/boundary proof; all unpaid TEST expense rows roll back.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT md5(pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure))='157eb1862f4e1e5115ad7b0832269931';
 ASSERT has_function_privilege('authenticated','public.get_club_finance_summary_v2(date,date,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.get_club_finance_summary_v2(date,date,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_club_finance_summary_v2(date,date,uuid)','EXECUTE');
 ASSERT (SELECT NOT prosecdef AND provolatile='s' FROM pg_proc WHERE oid='public.get_club_finance_summary_v2(date,date,uuid)'::regprocedure);
 ASSERT NOT EXISTS(SELECT 1 FROM club_expenses WHERE idempotency_key LIKE 'LOCAL582-%');
 PERFORM set_config('vinpoker582.expenses',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb)::text) FROM club_expenses e),false);
END $$;
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
DO $$
DECLARE club constant uuid := 'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 start_at constant timestamptz := '2035-10-01T00:00:00+07:00';
 next_at constant timestamptz := '2035-10-02T00:00:00+07:00';
 baseline numeric; response jsonb; from_ny jsonb; expected jsonb;
BEGIN
 SET LOCAL ROLE authenticated;
 baseline := (public.get_club_finance_summary_v2('2035-10-01','2035-10-01',club)#>>'{cost,clubExpenses}')::numeric;
 RESET ROLE;
 INSERT INTO public.club_expenses(club_id,category,amount_vnd,description,incurred_at,entered_by,idempotency_key)
 SELECT club,enum_first(NULL::public.expense_category),amount,'LOCAL582 rollback boundary TEST',occurred_at,
  '675fe35e-60a8-4452-bb90-e79486d54da6'::uuid,'LOCAL582-'||ordinal
 FROM (VALUES(1,1,start_at-interval '1 microsecond'),(2,10,start_at),
  (3,100,next_at-interval '1 microsecond'),(4,1000,next_at)) fixture(ordinal,amount,occurred_at);
 SET LOCAL ROLE authenticated;
 SET LOCAL timezone='UTC';
 response := public.get_club_finance_summary_v2('2035-10-01','2035-10-01',club);
 ASSERT current_setting('timezone')='UTC';
 ASSERT (response#>>'{cost,clubExpenses}')::numeric-baseline=110;
 ASSERT response->>'fromDate'='2035-10-01' AND response->>'toDate'='2035-10-01';
 ASSERT response->>'clubId'=club::text AND response->>'timeZone'='Asia/Ho_Chi_Minh';
 ASSERT response->'periodEndExclusive'='true'::jsonb;
 ASSERT (response->>'periodFrom')::timestamptz=start_at AND (response->>'periodTo')::timestamptz=next_at;
 SET LOCAL timezone='America/New_York';
 from_ny := public.get_club_finance_summary_v2('2035-10-01','2035-10-01',club);
 ASSERT current_setting('timezone')='America/New_York' AND from_ny=response;
 SET LOCAL timezone='Asia/Ho_Chi_Minh';
 expected := public.get_club_finance_summary(start_at,next_at-interval '1 microsecond',club);
 ASSERT response-ARRAY['fromDate','toDate','clubId','periodFrom','periodTo','periodEndExclusive','timeZone']=expected;
 ASSERT public.get_club_finance_summary_v2('2035-10-01','2035-10-01',NULL)->'clubId'='null'::jsonb;
 BEGIN PERFORM public.get_club_finance_summary_v2(NULL,'2035-10-01',club);RAISE EXCEPTION 'expected date rejection';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.get_club_finance_summary_v2('2035-10-02','2035-10-01',club);RAISE EXCEPTION 'expected range rejection';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.get_club_finance_summary_v2('2035-10-01','infinity',club);RAISE EXCEPTION 'expected infinity rejection';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',true);
 BEGIN PERFORM public.get_club_finance_summary_v2('2035-10-01','2035-10-01',club);RAISE EXCEPTION 'expected club denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.get_club_finance_summary_v2('2035-10-01','2035-10-01',club);RAISE EXCEPTION 'expected anonymous denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RESET ROLE;
 SET LOCAL ROLE anon;
 BEGIN PERFORM public.get_club_finance_summary_v2('2035-10-01','2035-10-01',club);RAISE EXCEPTION 'expected anon ACL denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 BEGIN PERFORM public.get_club_finance_summary_v2('2035-10-01','2035-10-01',club);RAISE EXCEPTION 'expected service ACL denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RESET ROLE;
 RAISE NOTICE 'FINANCE582_V2_FULL_DAY110_TIMEZONE_INDEPENDENT_LEGACY_FORMULAS_EQUAL_SCOPE_ACL_PASS';
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM club_expenses WHERE idempotency_key LIKE 'LOCAL582-%');
 ASSERT (SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb)::text) FROM club_expenses e)=current_setting('vinpoker582.expenses');
 ASSERT md5(pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure))='157eb1862f4e1e5115ad7b0832269931';
 RAISE NOTICE 'FINANCE582_FULL_EXPENSE_SNAPSHOT_AND_LEGACY_DEFINITION_UNCHANGED';
END $$;
