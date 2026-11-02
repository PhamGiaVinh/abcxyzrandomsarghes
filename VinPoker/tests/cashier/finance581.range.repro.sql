-- Diagnostic RED evidence, NOT a fix/PASS. All four unpaid TEST expenses roll back.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT md5(pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure))='157eb1862f4e1e5115ad7b0832269931';
 ASSERT NOT EXISTS(SELECT 1 FROM club_expenses WHERE idempotency_key LIKE 'LOCAL581-%');
 PERFORM set_config('vinpoker581.expenses',coalesce((SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb)::text) FROM club_expenses e),''),false);
END $$;
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
DO $$
DECLARE
 club constant uuid := 'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 start_at constant timestamptz := '2035-10-01T00:00:00+07:00';
 next_at constant timestamptz := '2035-10-02T00:00:00+07:00';
 old_before numeric; exact_before numeric; next_before numeric; ny_before numeric;
 old_after numeric; exact_after numeric; next_after numeric; ny_after numeric;
BEGIN
 SET LOCAL ROLE authenticated;
 old_before := (public.get_club_finance_summary(start_at,next_at-interval '1 second',club)#>>'{cost,clubExpenses}')::numeric;
 exact_before := (public.get_club_finance_summary(start_at,next_at-interval '1 microsecond',club)#>>'{cost,clubExpenses}')::numeric;
 next_before := (public.get_club_finance_summary(start_at,next_at,club)#>>'{cost,clubExpenses}')::numeric;
 ny_before := (public.get_club_finance_summary('2035-10-01T00:00:00-04:00','2035-10-01T23:59:59-04:00',club)#>>'{cost,clubExpenses}')::numeric;
 RESET ROLE;
 INSERT INTO public.club_expenses(club_id,category,amount_vnd,description,incurred_at,entered_by,idempotency_key)
 SELECT club,enum_first(NULL::public.expense_category),amount,'LOCAL581 rollback boundary TEST',occurred_at,
  '675fe35e-60a8-4452-bb90-e79486d54da6'::uuid,'LOCAL581-'||ordinal
 FROM (VALUES(1,1,start_at-interval '1 microsecond'),(2,10,start_at),
  (3,100,next_at-interval '1 microsecond'),(4,1000,next_at)) fixture(ordinal,amount,occurred_at);
 SET LOCAL ROLE authenticated;
 old_after := (public.get_club_finance_summary(start_at,next_at-interval '1 second',club)#>>'{cost,clubExpenses}')::numeric;
 exact_after := (public.get_club_finance_summary(start_at,next_at-interval '1 microsecond',club)#>>'{cost,clubExpenses}')::numeric;
 next_after := (public.get_club_finance_summary(start_at,next_at,club)#>>'{cost,clubExpenses}')::numeric;
 ny_after := (public.get_club_finance_summary('2035-10-01T00:00:00-04:00','2035-10-01T23:59:59-04:00',club)#>>'{cost,clubExpenses}')::numeric;
 RESET ROLE;
 ASSERT exact_after-exact_before=110;
 ASSERT old_after-old_before=10;
 ASSERT next_after-next_before=1110;
 ASSERT ny_after-ny_before=1100;
 RAISE NOTICE 'FINANCE581_BUG_REPRODUCED_EXPECT110_OLD10_NAIVE_NEXTMIDNIGHT1110_BROWSER_NY1100_NOT_FIXED';
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM club_expenses WHERE idempotency_key LIKE 'LOCAL581-%');
 ASSERT (SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb)::text) FROM club_expenses e)=current_setting('vinpoker581.expenses');
 RAISE NOTICE 'FINANCE581_DIAGNOSTIC_FULL_EXPENSE_SNAPSHOT_RESTORED';
END $$;
