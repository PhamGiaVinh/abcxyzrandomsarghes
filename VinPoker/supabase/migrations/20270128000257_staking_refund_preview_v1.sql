-- CLIcandidate20261023155707 -> forward257. LOCAL ONLY, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.get_staking_refund_preview_v1(uuid)') IS NOT NULL
 OR to_regclass('public.staking_refund_receipts_v1') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000257')
 THEN RAISE EXCEPTION 'staking257_catalog_drift';END IF;
END $$;
CREATE FUNCTION public.get_staking_refund_preview_v1(p_deal uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();d public.staking_deals%ROWTYPE;r public.staking_refund_receipts_v1%ROWTYPE;
 is_super boolean; label_value text; n bigint; amount numeric; bad boolean; result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'staking_refund_preview_denied' USING ERRCODE='42501';END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin') INTO is_super;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal;
 IF NOT FOUND OR (NOT is_super AND NOT(d.club_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role='cashier') AND public.is_club_cashier(actor,d.club_id)))
 THEN RAISE EXCEPTION 'staking_refund_preview_denied' USING ERRCODE='42501';END IF;
 label_value:=coalesce(nullif(d.custom_event_name,''),(SELECT name FROM public.tournaments WHERE id=d.tournament_id),'Deal #'||left(d.id::text,6));
 result:=jsonb_build_object('deal_id',d.id,'club_id',d.club_id,'label',label_value);
 IF d.status='deal_refunded' THEN
  SELECT * INTO r FROM public.staking_refund_receipts_v1 WHERE deal_id=d.id;
  IF NOT FOUND OR r.response->>'success' IS DISTINCT FROM 'true' OR r.response->>'deal_id' IS DISTINCT FROM d.id::text
  THEN RETURN result||jsonb_build_object('state','needs_attention','reason','refund_receipt_unproven');END IF;
  SELECT count(*),coalesce(sum(amount_vnd),0),coalesce(bool_or(amount_vnd<0 OR amount_vnd IS NULL),false)
  INTO n,amount,bad FROM public.escrow_transactions WHERE deal_id=d.id AND transaction_type='refund';
  IF bad OR n IS DISTINCT FROM (r.response->>'refunded_backers')::bigint OR amount>9007199254740991
  THEN RETURN result||jsonb_build_object('state','needs_attention','reason','refund_ledger_unproven');END IF;
  RETURN result||jsonb_build_object('state','refunded','amount_vnd',amount,'purchase_count',n,
   'request_id',CASE WHEN r.actor_id=actor THEN r.request_id ELSE NULL END);
 END IF;
 IF d.status NOT IN('funded','locked','result_entered','result_verified') THEN
  RETURN result||jsonb_build_object('state','not_refundable');END IF;
 IF EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=d.id AND transaction_type='refund')
 OR EXISTS(SELECT 1 FROM public.staking_purchases WHERE deal_id=d.id AND status='refunded')
 OR EXISTS(SELECT 1 FROM public.staking_ledger WHERE deal_id=d.id)
 OR EXISTS(SELECT 1 FROM public.payout_recipients WHERE deal_id=d.id)
 THEN RETURN result||jsonb_build_object('state','needs_attention','reason','legacy_refund_or_payout_evidence');END IF;
 SELECT count(*),coalesce(sum(amount_vnd),0),coalesce(bool_or(amount_vnd<0 OR amount_vnd IS NULL),false)
 INTO n,amount,bad FROM public.staking_purchases WHERE deal_id=d.id AND status='funded';
 IF bad OR amount>9007199254740991 THEN RETURN result||jsonb_build_object('state','needs_attention','reason','invalid_funded_amount');END IF;
 RETURN result||jsonb_build_object('state','eligible','amount_vnd',amount,'purchase_count',n);
END $$;
REVOKE ALL ON FUNCTION public.get_staking_refund_preview_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_refund_preview_v1(uuid) TO authenticated;
COMMIT;
