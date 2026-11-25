-- PENDING ONLY: standalone read-only PT payslip/recipient history.
-- No payment writer, table grant, installment schema/index, status or report change.
-- ROLLBACK: use finance_pt_statement_reads_v1.rollback.sql; only two new RPCs.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
  IF EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')) THEN
    RAISE EXCEPTION 'PT_STATEMENT_READS_TARGET_COLLISION'; END IF;
  IF to_regprocedure('public.get_dealer_payroll_statement(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PT_STATEMENT_READS_AUTHORIZE_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid='public.get_dealer_payroll_statement(uuid)'::regprocedure
      AND md5(p.prosrc)='cb89ab61460df145c0731806f29da523'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
      AND p.prokind='f' AND NOT p.proretset AND p.prorettype='jsonb'::regtype
      AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'
      AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      AND p.proargnames=ARRAY['p_statement_id'] AND p.proconfig=ARRAY['search_path=public']
      AND p.proacl='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]) THEN
    RAISE EXCEPTION 'PT_STATEMENT_READS_AUTHORIZE_DRIFT'; END IF;
END $guard$;

CREATE FUNCTION public.get_pt_statement_installments_v1(p_statement_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$ DECLARE s public.dealer_payroll_statements%rowtype; paid numeric; payments jsonb; BEGIN
  SELECT * INTO s FROM public.dealer_payroll_statements WHERE id=p_statement_id AND statement_kind='part_time_settlement';
  IF NOT FOUND THEN RAISE EXCEPTION 'PT_INSTALLMENT_STATEMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  -- Accountants read only this exact club's payment facts. Other readers use
  -- the established statement policy, including the exact linked recipient.
  -- Mutation authorization continues to use _assert_dealer_payroll_statement_actor.
  IF NOT EXISTS(SELECT FROM public.club_accountants WHERE club_id=s.club_id AND user_id=auth.uid()) THEN
    PERFORM public.get_dealer_payroll_statement(s.id);
  END IF;
  IF EXISTS(SELECT FROM public.dealer_pt_wage_payments WHERE statement_id=s.id
    AND (club_id IS DISTINCT FROM s.club_id OR dealer_id IS DISTINCT FROM s.dealer_id)) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_PAYMENT_SCOPE_INVALID' USING ERRCODE='55000'; END IF;
  SELECT coalesce(sum(amount_vnd),0),coalesce(jsonb_agg(jsonb_build_object('payment_id',id,'amount_vnd',amount_vnd,
    'paid_at',paid_at,'payment_method',payment_method,'payment_reference',payment_reference) ORDER BY created_at,id),'[]'::jsonb)
    INTO paid,payments FROM public.dealer_pt_wage_payments
    WHERE statement_id=s.id AND club_id=s.club_id AND dealer_id=s.dealer_id AND voided_at IS NULL;
  IF paid>s.net_amount_vnd OR (s.state IN ('voided','replaced') AND paid<>0) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_STATUS_INVALID_TOTALS' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('statement_id',s.id,'statement_hash',s.statement_hash,'state',s.state,
    'club_id',s.club_id,'dealer_id',s.dealer_id,'dealer_name',s.dealer_snapshot->>'full_name',
    'club_name',s.club_snapshot->>'club_name','finalized_at',s.finalized_at,'as_of',now(),
    'gross_amount_vnd',s.gross_amount_vnd,'deduction_amount_vnd',s.deduction_amount_vnd,
    'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('line_no',l.line_no,'label',l.label,
      'quantity',l.quantity,'unit',l.unit,'unit_rate_vnd',l.unit_rate_vnd,'amount_vnd',l.amount_vnd) ORDER BY l.line_no)
      FROM public.dealer_payroll_statement_lines l WHERE l.statement_id=s.id),'[]'::jsonb),
    'approved_amount_vnd',s.net_amount_vnd,'paid_total_vnd',paid,
    'remaining_vnd',CASE WHEN s.state IN ('voided','replaced') THEN 0 ELSE s.net_amount_vnd-paid END,'payments',payments);
END $$;
REVOKE ALL ON FUNCTION public.get_pt_statement_installments_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_pt_statement_installments_v1(uuid) TO authenticated;

CREATE FUNCTION public.list_my_pt_statements_v1(p_club_id uuid,p_dealer_id uuid,
  p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$ DECLARE s record; detail jsonb; items jsonb:='[]'::jsonb; last_cursor jsonb; next_cursor jsonb;
BEGIN
  -- Identical linked-recipient policy to the established payslip reader. An
  -- inactive employee retains historical self-read, never permission to pay.
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT FROM public.dealers d
    WHERE d.id=p_dealer_id AND d.club_id=p_club_id AND d.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'PT_RECIPIENT_HISTORY_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF (p_before_at IS NULL)<>(p_before_id IS NULL) OR (p_before_at IS NOT NULL AND (
    NOT isfinite(p_before_at) OR NOT EXISTS(SELECT FROM public.dealer_payroll_statements t
      WHERE t.id=p_before_id AND t.finalized_at=p_before_at AND t.club_id=p_club_id AND t.dealer_id=p_dealer_id
        AND t.statement_kind='part_time_settlement' AND t.state IN ('finalized','pdf_rendered','sent','delivery_failed','voided','replaced')))) THEN
    RAISE EXCEPTION 'PT_RECIPIENT_HISTORY_CURSOR_INVALID' USING ERRCODE='22023'; END IF;
  FOR s IN SELECT id,finalized_at FROM public.dealer_payroll_statements
    WHERE club_id=p_club_id AND dealer_id=p_dealer_id AND statement_kind='part_time_settlement'
      AND state IN ('finalized','pdf_rendered','sent','delivery_failed','voided','replaced')
      AND (p_before_at IS NULL OR (finalized_at,id)<(p_before_at,p_before_id))
    ORDER BY finalized_at DESC,id DESC LIMIT 21
  LOOP
    IF jsonb_array_length(items)=20 THEN next_cursor:=last_cursor; EXIT; END IF;
    -- Reuse established server-authoritative paid/debt and immutable detail
    -- validation. Do not infer payment from a singular final-installment marker.
    detail:=public.get_pt_statement_installments_v1(s.id);
    items:=items||jsonb_build_array(jsonb_build_object('statement_id',detail->'statement_id',
      'statement_hash',detail->'statement_hash','club_id',detail->'club_id','dealer_id',detail->'dealer_id',
      'net_amount_vnd',detail->'approved_amount_vnd','paid_total_vnd',detail->'paid_total_vnd',
      'remaining_vnd',detail->'remaining_vnd','state',detail->'state','finalized_at',detail->'finalized_at'));
    last_cursor:=jsonb_build_object('statement_id',s.id,'finalized_at',s.finalized_at);
  END LOOP;
  RETURN jsonb_build_object('club_id',p_club_id,'dealer_id',p_dealer_id,'as_of',now(),
    'items',items,'next_cursor',next_cursor);
END $$;
REVOKE ALL ON FUNCTION public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid) TO authenticated;
COMMIT;
