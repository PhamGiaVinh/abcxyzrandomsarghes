\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_finance_pt' THEN
    RAISE EXCEPTION 'isolated_database_required';
  END IF;
  IF EXISTS(SELECT FROM public.dealers) OR EXISTS(SELECT FROM public.clubs) THEN
    RAISE EXCEPTION 'empty_schema_restore_required';
  END IF;
END $$;
INSERT INTO auth.users(id) VALUES
 ('17950000-0000-4000-8000-000000000011'),
 ('17950000-0000-4000-8000-000000000022'),
 ('17950000-0000-4000-8000-000000000033');
INSERT INTO public.profiles(user_id,display_name) VALUES
 ('17950000-0000-4000-8000-000000000011','Finance TEST owner A'),
 ('17950000-0000-4000-8000-000000000022','Finance TEST owner B'),
 ('17950000-0000-4000-8000-000000000033','Finance TEST accountant A');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('17950000-0000-4000-8000-000000000001','17950000-0000-4000-8000-000000000011','Finance TEST A','TEST','approved'),
 ('17950000-0000-4000-8000-000000000002','17950000-0000-4000-8000-000000000022','Finance TEST B','TEST','approved');
INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES
 ('17950000-0000-4000-8000-000000000001','17950000-0000-4000-8000-000000000033','17950000-0000-4000-8000-000000000011');
SET LOCAL request.jwt.claim.sub = '17950000-0000-4000-8000-000000000011';
INSERT INTO public.dealers(id,club_id,full_name,status,employment_type,hourly_rate_vnd) VALUES
 ('17950000-0000-4000-8000-000000000051','17950000-0000-4000-8000-000000000001','Finance PT A','active','part_time',60000),
 ('17950000-0000-4000-8000-000000000052','17950000-0000-4000-8000-000000000002','Finance PT B','active','part_time',60000),
 ('17950000-0000-4000-8000-000000000053','17950000-0000-4000-8000-000000000001','Finance FT A','active','full_time',60000);
-- Keep real triggers, constraints and calculator. The explicit historical rate
-- belongs only to the newly seeded TEST dealer in this empty isolated database.
INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by)
VALUES ('17950000-0000-4000-8000-000000000051',60000,true,now()-interval '4 hours','17950000-0000-4000-8000-000000000011');
INSERT INTO public.dealer_attendance(dealer_id,status,current_state,check_in_time,check_out_time)
VALUES ('17950000-0000-4000-8000-000000000051','checked_out','checked_out',now()-interval '2 hours',now()-interval '1 hour');
-- Establish the existing authorization failure through the real captured reader.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '17950000-0000-4000-8000-000000000033';
DO $$ BEGIN
  BEGIN
    PERFORM public.get_club_pt_wages('17950000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'baseline_accountant_was_not_denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
COMMIT;
SELECT 'CAPTURED_SCHEMA_BASELINE_ACCOUNTANT_DENIED' AS result;
