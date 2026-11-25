-- PENDING ONLY. Read-only recipient entry; no table grants or payment authority.
-- Requires the separately qualified statement detail reader. Does not enable writes.
-- ROLLBACK: drop only this new function; retain every original statement/payment.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF to_regprocedure('public.get_pt_statement_installments_v1(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PT_RECIPIENT_HISTORY_DETAIL_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid='public.get_pt_statement_installments_v1(uuid)'::regprocedure
      AND md5(p.prosrc)='191f8b9de02702a828a1628d73ba8658'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
      AND p.proconfig=ARRAY['search_path=""']
      -- Existing detail inherits service_role EXECUTE from the captured
      -- schema's postgres/public default ACL. This does not grant a new role.
      AND p.proacl='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]) THEN
    RAISE EXCEPTION 'PT_RECIPIENT_HISTORY_DETAIL_DRIFT' USING DETAIL=(
      SELECT jsonb_build_object('source_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),
        'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl)::text
      FROM pg_catalog.pg_proc p WHERE p.oid='public.get_pt_statement_installments_v1(uuid)'::regprocedure);
  END IF;
END $$;
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
