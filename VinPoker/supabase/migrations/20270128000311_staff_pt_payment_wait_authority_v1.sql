-- Revalidate STAFF PT payment authority after per-staff mutex; preserve money formula and history.
DO $prerequisite$ BEGIN IF to_regprocedure('public.pay_staff_pt_balance(uuid,text,text,text,text)') IS NULL OR to_regprocedure('public._staff_pt_wage_balance(uuid)') IS NULL THEN RAISE EXCEPTION 'staff_pt_311_requires_current_payment_basis';END IF;END $prerequisite$;
CREATE OR REPLACE FUNCTION public.pay_staff_pt_balance(p_staff_id uuid, p_payment_method text, p_payment_reference text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor   uuid := auth.uid();
  v_staff   record;
  v_key     text;
  v_prior   record;
  v_bal     jsonb;
  v_amount  bigint;
  v_minutes integer;
  v_rate    integer;
  v_anchor  timestamptz;
  v_now     timestamptz := now();
  v_id      uuid;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, club_id, employment_type, status into v_staff
  from public.staff
  where id = p_staff_id and deleted_at is null;
  if not found or v_staff.status <> 'active' then
    raise exception 'Nhân viên không tồn tại hoặc không hoạt động' using errcode = 'P0002';
  end if;
  if v_staff.employment_type <> 'part_time' then
    raise exception 'Chỉ áp dụng cho nhân viên part-time' using errcode = 'P0001';
  end if;

  -- Authz: operator of the staff's club (Owner+Cashier).
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or public.has_role(v_actor, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = v_staff.club_id and c.owner_id = v_actor)
    or exists (select 1 from public.club_cashiers cc where cc.club_id = v_staff.club_id and cc.user_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);

  -- Per-staff lock BEFORE recompute/insert/reset (prevents double-pay race).
  perform pg_advisory_xact_lock(hashtext('staff_pt_wage:' || p_staff_id::text));

  -- Authority and staff scope may change while waiting. Re-read before any receipt or payment.
  select id, club_id, employment_type, status into v_staff
  from public.staff
  where id = p_staff_id and deleted_at is null FOR UPDATE;
  if not found or v_staff.status <> 'active' then
    raise exception 'Nhân viên không tồn tại hoặc không hoạt động' using errcode = 'P0002';
  end if;
  if v_staff.employment_type <> 'part_time' then
    raise exception 'Chỉ áp dụng cho nhân viên part-time' using errcode = 'P0001';
  end if;

  -- Authz: operator of the staff's club (Owner+Cashier).
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or public.has_role(v_actor, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = v_staff.club_id and c.owner_id = v_actor)
    or exists (select 1 from public.club_cashiers cc where cc.club_id = v_staff.club_id and cc.user_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;



  -- Idempotency: a supplied key that already paid → return the prior result (no 2nd insert).
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_prior
    from public.staff_pt_wage_payments
    where staff_id = p_staff_id and idempotency_key = v_key
    limit 1;
    if found then
      return jsonb_build_object(
        'payment_id', v_prior.id, 'idempotent', true,
        'amount_vnd', v_prior.amount_vnd, 'minutes_paid', v_prior.minutes_paid,
        'covered_from', v_prior.covered_from, 'covered_to', v_prior.covered_to, 'paid_at', v_prior.paid_at
      );
    end if;
  end if;

  -- Server-recompute the balance at this instant (ignore any client-supplied amount).
  v_bal     := public._staff_pt_wage_balance(p_staff_id);
  v_amount  := coalesce((v_bal->>'balance_vnd')::bigint, 0);
  v_minutes := coalesce((v_bal->>'accrued_minutes')::int, 0);
  v_rate    := coalesce((v_bal->>'hourly_rate_vnd')::int, 0);
  v_anchor  := coalesce((v_bal->>'last_reset_at')::timestamptz, v_now);

  if v_amount <= 0 then
    raise exception 'Số dư bằng 0 — không có gì để thanh toán' using errcode = 'P0001';
  end if;

  insert into public.staff_pt_wage_payments (
    staff_id, club_id, amount_vnd, minutes_paid, hourly_rate_vnd_snapshot,
    covered_from, covered_to, paid_at, paid_by, created_by,
    payment_method, payment_reference, idempotency_key, note
  ) values (
    p_staff_id, v_staff.club_id, v_amount, v_minutes, v_rate,
    v_anchor, v_now, v_now, v_actor, v_actor,
    p_payment_method, p_payment_reference, v_key, p_note
  )
  returning id into v_id;

  return jsonb_build_object(
    'payment_id', v_id, 'idempotent', false,
    'amount_vnd', v_amount, 'minutes_paid', v_minutes, 'hourly_rate_vnd_snapshot', v_rate,
    'covered_from', v_anchor, 'covered_to', v_now, 'paid_at', v_now
  );
end;
$function$;
