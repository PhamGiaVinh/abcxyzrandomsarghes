-- Prospective FT payment intent validation; no row/history rewrite or new payment path.
-- Preserve 308 PT summary guard, month/header/run lock order and post-wait authority.
-- Exact reviewed predecessor body or this body only; safe replay does not broaden provenance.
-- ROLLBACK: use the separately reviewed ROLLBACK_20261126131948_staff_ft_payment_intent_v1.sql only under the controlled runbook.
-- Rollback restores only this function; paid records and their original method/reference remain unchanged.
DO $prerequisite$ BEGIN
 IF pg_catalog.to_regprocedure('floor_private.staff_salary_period_lock_v1(uuid,integer,integer)') IS NULL
 OR pg_catalog.to_regprocedure('public.mark_staff_salary_paid(uuid,text,text)') IS NULL THEN
  RAISE EXCEPTION 'staff_ft_payment_intent_requires_reviewed_308';END IF;
 IF (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_catalog.pg_proc WHERE oid='public.mark_staff_salary_paid(uuid,text,text)'::regprocedure) NOT IN ('8c5291962da7d32c7a7184e664dd097e','a479b49abe2e0ebbe04eae69ddfbacf8') THEN
  RAISE EXCEPTION 'staff_ft_payment_intent_source_drift';END IF;
END $prerequisite$;
CREATE OR REPLACE FUNCTION public.mark_staff_salary_paid(p_run_id uuid, p_payment_method text DEFAULT NULL::text, p_payment_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_run record;
  v_reference text := nullif(btrim(p_payment_reference),'');
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_run from public.staff_salary_runs where id = p_run_id;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if not public._staff_salary_authorised(v_uid, v_run.club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  PERFORM floor_private.staff_salary_period_lock_v1(v_run.club_id,v_run.period_year,v_run.period_month);
  -- Consistent lock order: month, period header, run. Re-read after waiting.
  PERFORM 1 FROM public.staff_salary_periods WHERE club_id=v_run.club_id AND period_year=v_run.period_year AND period_month=v_run.period_month FOR UPDATE;
  SELECT * INTO v_run FROM public.staff_salary_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
  IF NOT public._staff_salary_authorised(v_uid,v_run.club_id) THEN RAISE EXCEPTION 'forbidden' USING errcode='42501';END IF;
  -- PT monthly runs are sums of canonical daily payouts, never another payable.
  IF v_run.employment_type='part_time' THEN
    RETURN jsonb_build_object('error','PT_MONTHLY_PAYMENT_SUMMARY_ONLY','detail','Bảng tháng PT chỉ tổng hợp khoản đã trả theo ngày, không chi trả lại từ đây.');
  END IF;
  -- [S7] owner must have approved the month's report before anyone can be marked paid.
  if not exists (
    select 1 from public.staff_salary_periods p
    where p.club_id = v_run.club_id and p.period_year = v_run.period_year
      and p.period_month = v_run.period_month and p.status = 'approved'
  ) then
    return jsonb_build_object('error', 'NOT_APPROVED', 'detail', 'Chủ CLB chưa duyệt bảng lương tháng này.');
  end if;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash','bank_transfer') THEN
    RETURN jsonb_build_object('error','INVALID_PAYMENT_METHOD','detail','Chọn tiền mặt hoặc chuyển khoản.');
  END IF;
  IF p_payment_method='bank_transfer' AND v_reference IS NULL THEN
    RETURN jsonb_build_object('error','PAYMENT_REFERENCE_REQUIRED','detail','Nhập mã tham chiếu chuyển khoản.');
  END IF;
  IF p_payment_method='cash' AND v_reference IS NOT NULL THEN
    RETURN jsonb_build_object('error','INVALID_PAYMENT_REFERENCE','detail','Khoản tiền mặt không dùng mã tham chiếu chuyển khoản.');
  END IF;
  IF v_run.status='paid' THEN
    IF v_run.payment_method IS DISTINCT FROM p_payment_method
      OR nullif(btrim(v_run.payment_reference),'') IS DISTINCT FROM v_reference THEN
      RETURN jsonb_build_object('error','PAYMENT_INTENT_CONFLICT',
        'detail','Khoản lương đã ghi chi với phương thức hoặc tham chiếu khác. Tải lại phiếu để đối chiếu.',
        'run_id',v_run.id,'payment_method',v_run.payment_method,'payment_reference',v_run.payment_reference);
    END IF;
    RETURN jsonb_build_object('status','paid','idempotent',true,'run_id',v_run.id,
      'club_id',v_run.club_id,'staff_id',v_run.staff_id,'period_year',v_run.period_year,'period_month',v_run.period_month,
      'net_vnd',v_run.net_vnd,'paid_at',v_run.paid_at,'paid_by',v_run.paid_by,
      'payment_method',v_run.payment_method,'payment_reference',v_run.payment_reference);
  END IF;
  IF v_run.status<>'locked' THEN
    RETURN jsonb_build_object('error','STALE_SALARY_RUN','run_id',p_run_id,'status',v_run.status);
  END IF;

  update public.staff_salary_runs
  set status = 'paid', paid_at = now(), paid_by = v_uid,
      payment_method = p_payment_method, payment_reference = v_reference
  where id = p_run_id and status = 'locked'
  RETURNING * INTO v_run;

  return jsonb_build_object('status','paid','idempotent',false,'run_id',v_run.id,
      'club_id',v_run.club_id,'staff_id',v_run.staff_id,'period_year',v_run.period_year,'period_month',v_run.period_month,
      'net_vnd',v_run.net_vnd,'paid_at',v_run.paid_at,'paid_by',v_run.paid_by,
      'payment_method',v_run.payment_method,'payment_reference',v_run.payment_reference);
end;
$function$;

