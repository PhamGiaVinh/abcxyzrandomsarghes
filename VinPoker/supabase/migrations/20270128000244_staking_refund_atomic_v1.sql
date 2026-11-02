-- CLI candidate20261023134827 -> forward slot244. LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_refund_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.commit_staking_refund_v1(uuid,uuid,uuid,text)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000244')
 THEN RAISE EXCEPTION 'staking244_catalog_collision';END IF;
END $$;
CREATE TABLE public.staking_refund_receipts_v1(
 actor_id uuid NOT NULL, request_id uuid NOT NULL,
 deal_id uuid NOT NULL UNIQUE REFERENCES public.staking_deals(id),
 payload jsonb NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE public.staking_refund_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_refund_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.commit_staking_refund_v1(p_actor uuid,p_request uuid,p_deal uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE; r public.staking_refund_receipts_v1%ROWTYPE;
 purchase public.staking_purchases%ROWTYPE; intent jsonb; outcome jsonb; n integer:=0;
 reason_value text:=btrim(p_reason); had_release boolean; is_super boolean;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'staking_refund_service_required' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR p_request IS NULL OR p_deal IS NULL OR reason_value IS NULL
 OR length(reason_value) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'staking_refund_invalid_payload';END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin') INTO is_super;
 IF NOT is_super AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='cashier')
 THEN RAISE EXCEPTION 'staking_refund_forbidden' USING ERRCODE='42501';END IF;
 -- Match release request -> deal -> ordered purchases. Never lock a late request in reverse order.
 PERFORM id FROM public.staking_release_requests WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 had_release:=FOUND;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_refund_deal_not_found';END IF;
 IF NOT is_super AND (d.club_id IS NULL OR NOT public.is_club_cashier(p_actor,d.club_id))
 THEN RAISE EXCEPTION 'staking_refund_club_denied' USING ERRCODE='42501';END IF;
 intent:=jsonb_build_object('deal_id',p_deal,'reason',reason_value);
 SELECT * INTO r FROM public.staking_refund_receipts_v1 WHERE actor_id=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF r.payload IS DISTINCT FROM intent THEN RAISE EXCEPTION 'staking_refund_payload_conflict';END IF;
  RETURN r.response;
 END IF;
 IF NOT had_release AND EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=p_deal)
 THEN RAISE EXCEPTION 'staking_refund_retry_snapshot' USING ERRCODE='40001';END IF;
 IF d.status NOT IN ('funded','locked','result_entered','result_verified')
 OR EXISTS(SELECT 1 FROM public.staking_refund_receipts_v1 WHERE deal_id=p_deal)
 THEN RAISE EXCEPTION 'staking_refund_state_conflict';END IF;
 PERFORM id FROM public.staking_purchases WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 -- Old partial refunds cannot be inferred or silently replayed from mutable statuses.
 IF EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=p_deal AND transaction_type='refund')
 OR EXISTS(SELECT 1 FROM public.staking_purchases WHERE deal_id=p_deal AND status='refunded')
 OR EXISTS(SELECT 1 FROM public.staking_ledger WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.payout_recipients WHERE deal_id=p_deal)
 THEN RAISE EXCEPTION 'staking_refund_legacy_review_required';END IF;
 FOR purchase IN SELECT * FROM public.staking_purchases WHERE deal_id=p_deal AND status='funded' ORDER BY id LOOP
  IF purchase.amount_vnd IS NULL OR purchase.amount_vnd<0 THEN RAISE EXCEPTION 'staking_refund_invalid_amount';END IF;
  UPDATE public.staking_purchases SET status='refunded' WHERE id=purchase.id;
  INSERT INTO public.escrow_transactions(deal_id,transaction_type,amount_vnd,performed_by_admin_id,note)
  VALUES(p_deal,'refund',purchase.amount_vnd,p_actor,
   format('Refund to backer %s (%s%%) — %s',purchase.backer_id,purchase.percent,reason_value));
  n:=n+1;
 END LOOP;
 UPDATE public.staking_deals SET status='deal_refunded',refund_status='completed',refund_reason=reason_value,
  refunded_by=p_actor,refunded_at=now() WHERE id=p_deal;
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(p_deal,'refunded',p_actor,d.status,'deal_refunded',
  jsonb_build_object('reason',reason_value,'backer_count',n,'ledger_failures',0,'request_id',p_request));
 outcome:=jsonb_build_object('success',true,'deal_id',p_deal,'refunded_backers',n,'ledger_failures',0);
 INSERT INTO public.staking_refund_receipts_v1(actor_id,request_id,deal_id,payload,response)
 VALUES(p_actor,p_request,p_deal,intent,outcome);
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.commit_staking_refund_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_staking_refund_v1(uuid,uuid,uuid,text) TO service_role;
COMMIT;
