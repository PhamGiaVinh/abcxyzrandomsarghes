-- PENDING. Finance PT read-only access for the accountant assigned to the requested club.
-- Preserves the current wage calculation and existing operator read privileges.
-- Rollback before/after activation: remove this new endpoint after reverting its consumer.
-- No existing wage reader, statement, payment or saved amount is changed.
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = 'public.get_club_pt_wages(uuid)'::regprocedure)
     IS DISTINCT FROM '506820f7f553dc2a2c085cec3400d2d5' THEN
    RAISE EXCEPTION 'finance_pt_read_source_drift';
  END IF;
  IF pg_catalog.to_regprocedure('public.get_finance_dealer_pt_wages_v1(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'finance_pt_read_target_exists';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_finance_dealer_pt_wages_v1(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid                     uuid := auth.uid();
  v_rows                    jsonb := '[]'::jsonb;
  v_standby_accrual_enabled boolean := false;
  v_effective_from          timestamptz;
  r record;
  v_bal jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (
    public.has_role(v_uid, 'super_admin'::public.app_role)
    or public.has_role(v_uid, 'club_admin'::public.app_role)
    or exists (select 1 from public.clubs c where c.id = p_club_id and c.owner_id = v_uid)
    or exists (select 1 from public.club_cashiers cc where cc.club_id = p_club_id and cc.user_id = v_uid)
    or exists (select 1 from public.club_accountants ca where ca.club_id = p_club_id and ca.user_id = v_uid)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.standby_accrual_enabled, p.effective_from
    into v_standby_accrual_enabled, v_effective_from
  from public.dealer_pt_wage_accrual_policies p
  where p.club_id = p_club_id;

  v_standby_accrual_enabled := coalesce(v_standby_accrual_enabled, false);
  if not v_standby_accrual_enabled then
    v_effective_from := null;
  end if;

  for r in
    select d.id
    from public.dealers d
    where d.club_id = p_club_id
      and d.status = 'active'
      and d.employment_type = 'part_time'
      and d.deleted_at is null
    order by d.full_name
  loop
    v_bal := public._pt_wage_balance(r.id);
    v_bal := v_bal || jsonb_build_object(
      'last_payment', (
        select jsonb_build_object('amount_vnd', w.amount_vnd, 'paid_at', w.paid_at)
        from public.dealer_pt_wage_payments w
        where w.dealer_id = r.id and w.voided_at is null
        order by w.paid_at desc
        limit 1
      )
    );
    v_rows := v_rows || jsonb_build_array(v_bal);
  end loop;

  return jsonb_build_object(
    'club_id', p_club_id,
    'as_of', now(),
    'accrual_mode', case when v_standby_accrual_enabled then 'continuous_standby' else 'capped_24h' end,
    'standby_accrual_enabled', v_standby_accrual_enabled,
    'policy_effective_from', v_effective_from,
    'dealers', v_rows
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_finance_dealer_pt_wages_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_dealer_pt_wages_v1(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_finance_dealer_pt_wages_v1(uuid) IS 'Read-only PT wage projection, including accountants assigned to this club. Source calculations unchanged.';
