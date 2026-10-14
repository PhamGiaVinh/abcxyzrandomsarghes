\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.get_dealer_payroll(uuid,date,date)'::regprocedure
   AND position('payroll_legacy_read_club_authority_v1' IN prosrc)>0)
  OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.get_shift_payroll_summary(uuid,date)'::regprocedure
   AND position('payroll_legacy_read_club_authority_v1' IN prosrc)>0) THEN
  RAISE EXCEPTION 'payroll_read_guard_required';
 END IF;
END $$;
INSERT INTO auth.users(id) VALUES('e1820000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e1820000-0000-4000-8000-000000000002',
 'e1820000-0000-4000-8000-000000000001','Payroll read authority TEST','TEST');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('e1820000-0000-4000-8000-000000000003',
 'e1820000-0000-4000-8000-000000000002','Synthetic payroll TEST','active');
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claim.role='anon';
DO $$ DECLARE statement text; exposed text[]:='{}';BEGIN
 FOR statement IN SELECT unnest(ARRAY[
  'SELECT count(*) FROM public.get_dealer_payroll(''e1820000-0000-4000-8000-000000000002'',current_date,current_date)',
  'SELECT count(*) FROM public.get_shift_payroll_summary(''e1820000-0000-4000-8000-000000000002'',current_date)']) LOOP
  BEGIN EXECUTE statement; exposed:=array_append(exposed,statement);
  EXCEPTION WHEN insufficient_privilege THEN NULL;
   WHEN OTHERS THEN exposed:=array_append(exposed,'non_authorization_error:'||SQLSTATE||':'||statement);
  END;
 END LOOP;
 IF cardinality(exposed)>0 THEN RAISE EXCEPTION 'payroll_read_authority_failed: anonymous RPC admitted: %',exposed;END IF;
END $$;
RESET ROLE;
INSERT INTO auth.users(id) VALUES('e1820000-0000-4000-8000-000000000004'),
 ('e1820000-0000-4000-8000-000000000005'),('e1820000-0000-4000-8000-000000000006');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('e1820000-0000-4000-8000-000000000004','club_admin'),
 ('e1820000-0000-4000-8000-000000000006','super_admin');
INSERT INTO public.club_cashiers(club_id,user_id) VALUES
 ('e1820000-0000-4000-8000-000000000002','e1820000-0000-4000-8000-000000000005');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1820000-0000-4000-8000-000000000004';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='';
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.get_dealer_payroll('e1820000-0000-4000-8000-000000000002',current_date,current_date);
  RAISE EXCEPTION 'payroll_empty_uid_admitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  PERFORM * FROM public.get_shift_payroll_summary('e1820000-0000-4000-8000-000000000002',current_date);
  RAISE EXCEPTION 'shift_payroll_empty_uid_admitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SET LOCAL request.jwt.claim.sub='e1820000-0000-4000-8000-000000000004';
DO $$ DECLARE statement text;BEGIN
 FOR statement IN SELECT unnest(ARRAY[
  'SELECT count(*) FROM public.get_dealer_payroll(''e1820000-0000-4000-8000-000000000002'',current_date,current_date)',
  'SELECT count(*) FROM public.get_shift_payroll_summary(''e1820000-0000-4000-8000-000000000002'',current_date)']) LOOP
  BEGIN EXECUTE statement; RAISE EXCEPTION 'payroll_cross_club_read_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
DO $$ DECLARE actor uuid;BEGIN
 FOREACH actor IN ARRAY ARRAY['e1820000-0000-4000-8000-000000000005'::uuid,
  'e1820000-0000-4000-8000-000000000006'::uuid] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  IF (SELECT count(*) FROM public.get_dealer_payroll('e1820000-0000-4000-8000-000000000002',current_date,current_date))<>1 THEN
   RAISE EXCEPTION 'payroll_scoped_cashier_or_superadmin_read_failed';END IF;
 END LOOP;
END $$;
SET LOCAL request.jwt.claim.sub='e1820000-0000-4000-8000-000000000001';
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.get_dealer_payroll(NULL,current_date,current_date);
  RAISE EXCEPTION 'payroll_null_club_admitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  PERFORM * FROM public.get_shift_payroll_summary(NULL,current_date);
  RAISE EXCEPTION 'shift_payroll_null_club_admitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.get_dealer_payroll('e1820000-0000-4000-8000-000000000002',current_date,current_date))<>1 THEN
  RAISE EXCEPTION 'payroll_owner_read_failed';END IF;
END $$;
-- An allowed caller must still expose, not conceal, the existing type defect.
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.get_shift_payroll_summary('e1820000-0000-4000-8000-000000000002',current_date);
  RAISE EXCEPTION 'expected_existing_shift_payroll_type_defect_not_reproduced';
 EXCEPTION WHEN datatype_mismatch THEN
  RAISE NOTICE 'SHIFT_PAYROLL_TYPE_DEFECT_42804_REMAINS_UNFIXED';
 END;
END $$;
RESET ROLE;
ROLLBACK;
