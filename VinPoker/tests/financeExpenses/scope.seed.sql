-- Synthetic data only; caller must guard the isolated DB and transaction.
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_finance_expense' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
  IF EXISTS(SELECT FROM public.clubs) OR EXISTS(SELECT FROM public.club_expenses) THEN
    RAISE EXCEPTION 'empty_schema_restore_required';
  END IF;
END $$;
INSERT INTO auth.users(id) VALUES
 ('17980000-0000-4000-8000-000000000011'),
 ('17980000-0000-4000-8000-000000000022'),
 ('17980000-0000-4000-8000-000000000033');
INSERT INTO public.profiles(user_id,display_name) VALUES
 ('17980000-0000-4000-8000-000000000011','Expense TEST owner A'),
 ('17980000-0000-4000-8000-000000000022','Expense TEST owner B'),
 ('17980000-0000-4000-8000-000000000033','Expense TEST accountant A');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('17980000-0000-4000-8000-000000000001','17980000-0000-4000-8000-000000000011','Expense TEST A','TEST','approved'),
 ('17980000-0000-4000-8000-000000000002','17980000-0000-4000-8000-000000000022','Expense TEST B','TEST','approved');
INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES
 ('17980000-0000-4000-8000-000000000001','17980000-0000-4000-8000-000000000033','17980000-0000-4000-8000-000000000011');
