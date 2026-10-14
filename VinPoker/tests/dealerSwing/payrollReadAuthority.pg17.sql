\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.get_dealer_payroll(uuid,date,date)'::regprocedure))<>'900daa5d599dd082ca3afe28aba926f7'
  OR md5(pg_get_functiondef('public.get_shift_payroll_summary(uuid,date)'::regprocedure))<>'9294ceb26ab83cb9b61c45f828f639cc' THEN
  RAISE EXCEPTION 'payroll_read_live_definition_parity_required';
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
ROLLBACK;
