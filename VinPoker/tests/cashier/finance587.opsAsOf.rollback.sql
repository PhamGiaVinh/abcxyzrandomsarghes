-- Exact existing timestamp RPC; no new business formula or persisted fixture.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT md5(pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure))='157eb1862f4e1e5115ad7b0832269931';
 ASSERT NOT EXISTS(SELECT 1 FROM club_expenses WHERE idempotency_key LIKE 'LOCAL587-%');
 PERFORM set_config('vinpoker587.expenses',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb)::text) FROM club_expenses e),false);
END $$;
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
DO $$
DECLARE
 club constant uuid := 'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 start_at constant timestamptz := '2035-10-01T00:00:00+07:00';
 cutoff constant timestamptz := '2035-10-01T00:30:00.123+07:00';
 correct_before numeric; old_before numeric; extended_before numeric;
 correct_after numeric; old_after numeric; extended_after numeric;
BEGIN
 SET LOCAL ROLE authenticated;
 correct_before := (public.get_club_finance_summary(start_at,cutoff,club)#>>'{cost,clubExpenses}')::numeric;
 old_before := (public.get_club_finance_summary('2035-09-01T00:00:00Z',cutoff,club)#>>'{cost,clubExpenses}')::numeric;
 extended_before := (public.get_club_finance_summary(start_at,cutoff+interval '1 microsecond',club)#>>'{cost,clubExpenses}')::numeric;
 RESET ROLE;
 INSERT INTO public.club_expenses(club_id,category,amount_vnd,description,incurred_at,entered_by,idempotency_key)
 SELECT club,enum_first(NULL::public.expense_category),amount,'LOCAL587 rollback as-of TEST',occurred_at,
 '675fe35e-60a8-4452-bb90-e79486d54da6'::uuid,'LOCAL587-'||ordinal
 FROM (VALUES(1,1,start_at-interval '1 microsecond'),(2,10,start_at),
 (3,100,cutoff),(4,1000,cutoff+interval '1 microsecond')) fixture(ordinal,amount,occurred_at);
 SET LOCAL ROLE authenticated;
 correct_after := (public.get_club_finance_summary(start_at,cutoff,club)#>>'{cost,clubExpenses}')::numeric;
 old_after := (public.get_club_finance_summary('2035-09-01T00:00:00Z',cutoff,club)#>>'{cost,clubExpenses}')::numeric;
 extended_after := (public.get_club_finance_summary(start_at,cutoff+interval '1 microsecond',club)#>>'{cost,clubExpenses}')::numeric;
 RESET ROLE;
 ASSERT correct_after-correct_before=110;
 ASSERT old_after-old_before=111;
 ASSERT extended_after-extended_before=1110;
 RAISE NOTICE 'FINANCE587_CORRECT_START_AND_INCLUSIVE_EXACT_ASOF110_OLD111_EXTENDED1110_PASS';
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM club_expenses WHERE idempotency_key LIKE 'LOCAL587-%');
 ASSERT (SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb)::text) FROM club_expenses e)=current_setting('vinpoker587.expenses');
 RAISE NOTICE 'FINANCE587_FULL_EXPENSE_SNAPSHOT_RESTORED_PASS';
END $$;
