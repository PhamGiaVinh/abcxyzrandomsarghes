BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
CREATE FUNCTION pg_temp.staff469facts() RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staff x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staff_link_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.users x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staff_attendance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staff_pt_wage_payments x))::text);
$$;
DO $test$ DECLARE first_actor uuid:=gen_random_uuid();second_actor uuid:=gen_random_uuid();
 first_staff uuid:=gen_random_uuid();second_staff uuid:=gen_random_uuid();expired_staff uuid:=gen_random_uuid();
 club uuid:='9755fe63-669c-49d0-bea9-75177a3d30fc';baseline text;r jsonb;checked_in jsonb;
 first_code text:='TEST469A'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
 second_code text:='TEST469B'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
 expired_code text:='TEST469C'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
 BEGIN
 baseline:=pg_temp.staff469facts();
 BEGIN
  INSERT INTO auth.users(id) VALUES(first_actor),(second_actor);
  INSERT INTO public.staff(id,club_id,full_name,department,employment_type,hourly_rate_vnd,status,link_code,link_code_expires_at)
   VALUES(first_staff,club,'Staff469 rollback TEST A','service','part_time',50000,'active',upper(first_code),now()+interval '1 hour'),
    (second_staff,club,'Staff469 rollback TEST B','service','part_time',50000,'active',upper(second_code),now()+interval '1 hour'),
    (expired_staff,club,'Staff469 rollback expired TEST','service','part_time',50000,'active',upper(expired_code),now()-interval '1 minute');
  PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('role','authenticated',true);
  r:=public.staff_redeem_link_code(first_code);
  ASSERT r->>'error'='Unauthorized',r::text;
  PERFORM set_config('request.jwt.claim.sub',first_actor::text,true);
  r:=public.staff_redeem_link_code('  '||lower(first_code)||'  ');
  ASSERT r->>'status'='ok' AND r->>'staff_id'=first_staff::text AND r->>'club_id'=club::text,r::text;
  r:=public.staff_redeem_link_code(first_code);
  ASSERT r->>'error'='NOT_FOUND',r::text;
  r:=public.staff_redeem_link_code(second_code);
  ASSERT r->>'error'='ALREADY_LINKED_ELSEWHERE',r::text;
  checked_in:=public.staff_check_in(first_staff);
  ASSERT checked_in->>'outcome'='checked_in',checked_in::text;
  r:=public.staff_check_in(first_staff);
  ASSERT r->>'outcome'='already_checked_in' AND r->>'attendance_id'=checked_in->>'attendance_id',r::text;
  r:=public.get_my_staff_salary(first_staff);
  ASSERT r->>'staff_id'=first_staff::text AND r->>'club_id'=club::text
   AND r->'current_shift_open'='true'::jsonb AND (r->>'balance_vnd')::bigint=0,r::text;
  r:=public.staff_check_out(first_staff);
  ASSERT r->>'outcome'='checked_out' AND r->>'attendance_id'=checked_in->>'attendance_id'
   AND (r->>'total_worked_minutes_today')::integer=0,r::text;
  PERFORM set_config('request.jwt.claim.sub',second_actor::text,true);
  BEGIN
   PERFORM public.get_my_staff_salary(first_staff);
   RAISE EXCEPTION 'outsider salary unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN
   PERFORM public.staff_check_in(first_staff);
   RAISE EXCEPTION 'outsider check-in unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  r:=public.staff_redeem_link_code(first_code);
  ASSERT r->>'error'='NOT_FOUND',r::text;
  r:=public.staff_redeem_link_code(expired_code);
  ASSERT r->>'error'='EXPIRED',r::text;
  r:=public.staff_redeem_link_code(' ');
  ASSERT r->>'error'='INVALID_INPUT',r::text;
  PERFORM set_config('role','none',true);
  ASSERT EXISTS(SELECT 1 FROM public.staff WHERE id=first_staff AND user_id=first_actor AND link_code IS NULL AND link_code_expires_at IS NULL);
  ASSERT EXISTS(SELECT 1 FROM public.staff WHERE id=second_staff AND user_id IS NULL AND link_code=upper(second_code));
  ASSERT EXISTS(SELECT 1 FROM public.staff WHERE id=expired_staff AND user_id IS NULL);
  ASSERT (SELECT count(*) FROM public.staff_link_audit WHERE staff_id IN(first_staff,second_staff,expired_staff))=1;
  ASSERT EXISTS(SELECT 1 FROM public.staff_link_audit WHERE staff_id=first_staff AND user_id=first_actor AND actor=first_actor AND club_id=club);
  ASSERT (SELECT count(*) FROM public.staff_attendance WHERE staff_id=first_staff)=1;
  ASSERT NOT EXISTS(SELECT 1 FROM public.staff_pt_wage_payments WHERE staff_id IN(first_staff,second_staff,expired_staff));
  RAISE EXCEPTION USING ERRCODE='P0469',MESSAGE='rollback entire Staff469 fixture';
 EXCEPTION WHEN SQLSTATE 'P0469' THEN NULL;END;
 ASSERT pg_temp.staff469facts()=baseline;
 RAISE NOTICE 'STAFF469_NATIVE_LINK_CHECKIN_REPLAY_SALARY_CHECKOUT_DENIALS_AUDIT_EXACT_ROLLBACK_PASS';
END $test$;
ROLLBACK;
