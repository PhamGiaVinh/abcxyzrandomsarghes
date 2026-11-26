-- Prospective owner rule: completed FT days only; open source is retained for adjustment.
BEGIN;
DO $test$
DECLARE
  owner_id constant uuid := '16750000-0000-4000-8000-000000000001';
  employee constant uuid := '16750000-0000-4000-8000-000000000004';
  club constant uuid := '16750000-0000-4000-8000-000000000011';
  v_staff_id constant uuid := '16750000-0000-4000-8000-000000000021';
  foreign_admin constant uuid := '16750000-0000-4000-8000-000000000099';
  result jsonb; saved jsonb; source jsonb; denied boolean:=false;
BEGIN
  ASSERT current_database()='vinpoker_ops_l02';
  INSERT INTO auth.users(id)VALUES(owner_id),(employee);
  INSERT INTO public.profiles(user_id,display_name)VALUES(owner_id,'L02 closed FT owner TEST'),(employee,'L02 closed FT employee TEST');
  INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES(club,owner_id,'L02 closed FT TEST','TEST','approved');
  INSERT INTO public.staff(id,club_id,user_id,full_name,department,employment_type,monthly_salary_vnd,manual_bhxh_vnd,manual_tax_vnd,status)
    VALUES(v_staff_id,club,employee,'L02 closed FT','service','full_time',5200000,0,0,'active');
  INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time,check_out_time,total_worked_minutes_today)
    SELECT v_staff_id,date'2026-11-01'+d,'checked_out',
      (date'2026-11-01'+d+time'09:00')AT TIME ZONE'Asia/Ho_Chi_Minh',
      (date'2026-11-01'+d+time'17:00')AT TIME ZONE'Asia/Ho_Chi_Minh',480
    FROM generate_series(0,24)d;
  INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time)
    VALUES(v_staff_id,date'2026-11-26','checked_in',timestamptz'2026-11-26 09:00:00+07');
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SET LOCAL ROLE authenticated;
  result:=public.get_staff_salary_month(club,2026,11);
  ASSERT (result->'staff'->0->>'worked_days')::integer=25,result::text;
  ASSERT (result->'staff'->0->>'net_vnd')::bigint=5000000,result::text;
  result:=public.chot_staff_salary_month(club,2026,11);
  ASSERT (result->>'total_net_vnd')::bigint=5000000,result::text;
  result:=public.submit_staff_salary_month(club,2026,11,'L02 completed25/open1 TEST');
  ASSERT result->>'status'='submitted',result::text;
  result:=public.approve_staff_salary_month(club,2026,11);
  ASSERT result->>'status'='approved',result::text;
  RESET ROLE;
  SELECT to_jsonb(r) INTO saved FROM public.staff_salary_runs r WHERE r.staff_id=v_staff_id;
  SELECT snapshot INTO source FROM floor_private.staff_salary_sources_v1 WHERE run_id=(saved->>'id')::uuid;
  ASSERT source->>'version'='1',coalesce(source::text,'missing source snapshot');
  ASSERT (source->>'monthly_salary_vnd')::bigint=5200000;
  ASSERT (source->>'standard_shifts_per_month')::integer=26;
  ASSERT jsonb_array_length(source->'attendance')=25;
  ASSERT jsonb_array_length(source->'pending_attendance')=1;
  ASSERT (saved->>'net_vnd')::bigint=5000000;
  ASSERT saved->>'status'='locked';
  ASSERT (source->>'staff_id')::uuid=v_staff_id AND (source->>'club_id')::uuid=club;
  ASSERT (source->>'period_year')::integer=2026 AND (source->>'period_month')::integer=11;
  ASSERT NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.staff_salary_runs'::regclass
    AND attname='source_snapshot_v1' AND NOT attisdropped),'source proof exposed on legacy public salary row';
  BEGIN
    UPDATE floor_private.staff_salary_sources_v1 SET snapshot=snapshot WHERE run_id=(saved->>'id')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  ASSERT denied,'frozen source proof is mutable';
  INSERT INTO auth.users(id)VALUES(foreign_admin);
  INSERT INTO public.profiles(user_id,display_name)VALUES(foreign_admin,'Other club admin TEST');
  INSERT INTO public.user_roles(user_id,role)VALUES(foreign_admin,'club_admin');
  INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES(foreign_admin,foreign_admin,'Other admin club TEST','TEST','approved');
  PERFORM set_config('request.jwt.claim.sub',foreign_admin::text,true);
  SET LOCAL ROLE authenticated;
  denied:=false;
  BEGIN
    PERFORM snapshot FROM floor_private.staff_salary_sources_v1 WHERE run_id=(saved->>'id')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  ASSERT denied,'unrelated club_admin read new private attendance source';
  SELECT to_jsonb(r) INTO result FROM public.staff_salary_runs r WHERE r.id=(saved->>'id')::uuid;
  ASSERT result IS NOT NULL AND NOT(result?'source_snapshot_v1'),'new source leaked through legacy public SELECT';
  RESET ROLE;
END
$test$;
ROLLBACK;
