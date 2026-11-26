-- Function-only read shape rollback; no financial data changes.
-- Revert receipt-display consumer first or it will show explicit unknown metadata.
DO $prerequisite$ BEGIN
 IF pg_catalog.to_regprocedure('public.get_staff_salary_report(uuid,integer,integer)') IS NULL THEN
  RAISE EXCEPTION 'staff_salary_payment_report_requires_reviewed_reader';END IF;
 IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_catalog.pg_proc WHERE oid='public.get_staff_salary_report(uuid,integer,integer)'::regprocedure) NOT IN ('e42cb9276ccb2c67f679d02d5c9cb3c6','b711e1b84e4638e2084f127443f441cb') THEN
  RAISE EXCEPTION 'staff_salary_payment_report_source_drift';END IF;
END $prerequisite$;
CREATE OR REPLACE FUNCTION public.get_staff_salary_report(p_club_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_hdr jsonb;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select to_jsonb(p) into v_hdr from public.staff_salary_periods p
  where p.club_id = p_club_id and p.period_year = p_year and p.period_month = p_month;

  return jsonb_build_object(
    'club_id', p_club_id, 'period_year', p_year, 'period_month', p_month,
    'header', coalesce(v_hdr, jsonb_build_object('status', 'prepared')),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'staff_id', r.staff_id, 'employment_type', r.employment_type,
               'worked_days', r.worked_days, 'worked_minutes', r.worked_minutes,
               'gross_vnd', r.gross_vnd, 'manual_bhxh_vnd', r.manual_bhxh_vnd,
               'manual_tax_vnd', r.manual_tax_vnd, 'net_vnd', r.net_vnd,
               'status', r.status, 'full_name', s.full_name, 'department', s.department
             ) order by s.employment_type, s.full_name)
      from public.staff_salary_runs r join public.staff s on s.id = r.staff_id
      where r.club_id = p_club_id and r.period_year = p_year and r.period_month = p_month and r.status <> 'voided'
    ), '[]'::jsonb),
    'total_gross_vnd', (select coalesce(sum(gross_vnd),0) from public.staff_salary_runs
                        where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided'),
    'total_net_vnd', (select coalesce(sum(net_vnd),0) from public.staff_salary_runs
                      where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided')
  );
end;
$function$;
