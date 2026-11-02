-- Shared legacy producer and its callers. No historical attendance/payroll repair.
-- Multiple eligible legacy shifts require explicit operator selection via v1.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public._enter_dealer_pool(uuid,uuid,timestamptz)','6c007683d2c7df2949e70adb8cd06dac'),
  ('public._dealer_record_checkin(uuid,text)','915063283b37bb13a3b9786c633736f8'),
  ('public.bridge_shift_checkins_to_pool()','6a6a5aff4a0ed08a461773e9f86dfbbf'),
  ('public.operator_check_in_dealers(uuid,uuid,jsonb)','441f2461ed41049557c9ee5bbe56f8df')
 ) AS expected(signature,digest) LOOP
  IF to_regprocedure(r.signature) IS NULL OR
   md5(replace(pg_get_functiondef(to_regprocedure(r.signature)),chr(13),''))<>r.digest
  THEN RAISE EXCEPTION 'dealer_pool222_definition_drift: %',r.signature; END IF;
 END LOOP;
END $$;

CREATE FUNCTION floor_private.dealer_pool_attendance_matches_v1(p_dealer_id uuid,p_club_id uuid,p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_at IS NOT NULL AND pg_catalog.isfinite(p_at) AND
  (SELECT count(*)=1 AND count(*) FILTER(WHERE
    d.club_id=p_club_id AND d.deleted_at IS NULL AND d.status='active'
    AND s.club_id=p_club_id AND s.closed_at IS NULL AND s.archived_at IS NULL
    AND a.check_out_time IS NULL AND a.check_in_time<=p_at
    AND a.shift_date=(p_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-
      CASE WHEN s.end_time<=s.start_time AND (p_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<s.end_time THEN 1 ELSE 0 END
   )=1
   FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
   LEFT JOIN public.dealer_shifts s ON s.id=a.shift_id
   WHERE a.dealer_id=p_dealer_id AND a.status='checked_in');
$$;
REVOKE ALL ON FUNCTION floor_private.dealer_pool_attendance_matches_v1(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._enter_dealer_pool(p_dealer_id uuid,p_club_id uuid,p_check_in_time timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.dealer_shifts%ROWTYPE; operating_date date;
BEGIN
 IF p_dealer_id IS NULL OR p_club_id IS NULL OR p_check_in_time IS NULL OR NOT pg_catalog.isfinite(p_check_in_time) THEN RETURN false; END IF;
 PERFORM 1 FROM public.dealers WHERE id=p_dealer_id AND club_id=p_club_id
  AND status='active' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 BEGIN
  SELECT * INTO STRICT s FROM public.dealer_shifts WHERE club_id=p_club_id
   AND closed_at IS NULL AND archived_at IS NULL FOR SHARE;
 EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN false;
 END;
 operating_date:=(p_check_in_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
 IF s.end_time<=s.start_time AND (p_check_in_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<s.end_time THEN operating_date:=operating_date-1; END IF;
 -- Never turn a prior-day, malformed or cross-club attendance into availability.
 IF EXISTS(SELECT 1 FROM public.dealer_attendance WHERE dealer_id=p_dealer_id AND status='checked_in')
 OR EXISTS(SELECT 1 FROM public.dealer_assignments WHERE dealer_id=p_dealer_id
  AND status IN('assigned','pre_assigned','in_transition') AND released_at IS NULL) THEN RETURN false; END IF;
 BEGIN
  INSERT INTO public.dealer_attendance(dealer_id,shift_id,shift_date,status,current_state,check_in_time)
   VALUES(p_dealer_id,s.id,operating_date,'checked_in','available',p_check_in_time);
 EXCEPTION WHEN unique_violation THEN RETURN false;
 END;
 RETURN true;
END $$;

-- Patch only exact reviewed bodies, preserving existing event/audit and receipt logic.
DO $patch$ DECLARE body text; old text; new text; BEGIN
 body:=replace(pg_get_functiondef('public._dealer_record_checkin(uuid,text)'::regprocedure),chr(13),'');
 body:=replace(body,'v_shift_date date := (now() AT TIME ZONE ''UTC'')::date;','v_shift_date date;');
 -- Phone batch already locks dealer -> assignment. Direct/self callers use it too.
 old:=$old$BEGIN
  SELECT club_id, dealer_id, status, scheduled_start_at, checked_in_at$old$;
 new:=$new$BEGIN
  PERFORM 1 FROM public.dealers WHERE id=(SELECT dealer_id FROM public.dealer_shift_assignments WHERE id=p_assignment_id) FOR UPDATE;
  SELECT club_id, dealer_id, status, scheduled_start_at, checked_in_at$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'dealer_pool222_record_lock_drift'; END IF;
 body:=replace(body,old,new);
 body:=replace(body,'FROM public.dealer_shift_assignments WHERE id = p_assignment_id;',
  'FROM public.dealer_shift_assignments WHERE id = p_assignment_id FOR UPDATE;');
 old:=$old$SELECT EXISTS (SELECT 1 FROM public.dealer_attendance
                   WHERE dealer_id = v_dealer AND shift_date = v_shift_date AND status='checked_in') INTO v_already;$old$;
 new:='SELECT floor_private.dealer_pool_attendance_matches_v1(v_dealer,v_club_id,v_pool_at) INTO v_already;';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'dealer_pool222_record_precheck_drift'; END IF;
 body:=replace(body,old,new);
 old:=$old$ELSE
        v_reason := 'already_in_pool';
      END IF;$old$;
 new:=$new$ELSE
        IF floor_private.dealer_pool_attendance_matches_v1(v_dealer,v_club_id,v_pool_at) THEN
          v_reason := 'already_in_pool';
        ELSE
          v_reason := 'pool_entry_unverified';
        END IF;
      END IF;$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'dealer_pool222_record_false_success_drift'; END IF;
 EXECUTE replace(body,old,new);

 body:=replace(pg_get_functiondef('public.bridge_shift_checkins_to_pool()'::regprocedure),chr(13),'');
 old:='AND da.shift_date = (now() AT TIME ZONE ''UTC'')::date AND da.status = ''checked_in''';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'dealer_pool222_bridge_drift'; END IF;
 EXECUTE replace(body,old,'AND da.status = ''checked_in''');

 body:=replace(pg_get_functiondef('public.operator_check_in_dealers(uuid,uuid,jsonb)'::regprocedure),chr(13),'');
 old:=$old$ELSIF v_row.assignment_status = 'checked_in' THEN
          v_code := 'already_checked_in';
          SELECT a.checked_in_at INTO v_arrival_at
          FROM public.dealer_shift_assignments a
          WHERE a.id = v_row.shift_assignment_id;
          SELECT da.check_in_time INTO v_payroll_at
          FROM public.dealer_attendance da
          WHERE da.dealer_id = v_row.resolved_dealer_id
            AND da.status = 'checked_in'
          ORDER BY da.created_at DESC
          LIMIT 1;
        ELSIF v_row.assignment_status NOT IN ('published', 'confirmed') THEN$old$;
 new:=$new$ELSIF v_row.assignment_status NOT IN ('published', 'confirmed', 'checked_in') THEN$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'dealer_pool222_phone_scheduled_drift'; END IF;
 body:=replace(body,old,new);
 old:=$old$SELECT EXISTS (
          SELECT 1 FROM public.dealer_attendance da
          WHERE da.dealer_id = v_row.resolved_dealer_id
            AND da.status = 'checked_in'
        ) INTO v_entered;$old$;
 new:='SELECT floor_private.dealer_pool_attendance_matches_v1(v_row.resolved_dealer_id,p_expected_club_id,clock_timestamp()) INTO v_entered;';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'dealer_pool222_phone_unscheduled_drift'; END IF;
 EXECUTE replace(body,old,new);
END $patch$;
DO $$ BEGIN
 IF has_function_privilege('authenticated','public._enter_dealer_pool(uuid,uuid,timestamptz)','EXECUTE')
 OR has_function_privilege('anon','public._enter_dealer_pool(uuid,uuid,timestamptz)','EXECUTE')
 OR has_function_privilege('authenticated','floor_private.dealer_pool_attendance_matches_v1(uuid,uuid,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'dealer_pool222_acl'; END IF;
END $$;
COMMIT;
