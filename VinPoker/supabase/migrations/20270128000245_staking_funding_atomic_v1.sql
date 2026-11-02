-- CLI candidate20261023135329 -> forward slot245. LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_funding_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.commit_staking_funding_v1(uuid,uuid,text,text)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000245')
 THEN RAISE EXCEPTION 'staking245_catalog_collision';END IF;
END $$;
CREATE TABLE public.staking_funding_receipts_v1(
 purchase_id uuid PRIMARY KEY REFERENCES public.staking_purchases(id), actor_id uuid NOT NULL,
 payload jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staking_funding_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_funding_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.commit_staking_funding_v1(p_actor uuid,p_purchase uuid,p_bank_tx text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE; p public.staking_purchases%ROWTYPE;
 r public.staking_funding_receipts_v1%ROWTYPE; deal_id_value uuid; had_release boolean;
 bank_value text:=nullif(btrim(p_bank_tx),''); note_value text:=nullif(btrim(p_note),'');
 intent jsonb; outcome jsonb; is_super boolean; committed_total integer; funded_total integer;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'staking_funding_service_required' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR p_purchase IS NULL OR length(coalesce(bank_value,''))>200 OR length(coalesce(note_value,''))>1000
 THEN RAISE EXCEPTION 'staking_funding_invalid_payload';END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin') INTO is_super;
 IF NOT is_super AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='cashier')
 THEN RAISE EXCEPTION 'staking_funding_forbidden' USING ERRCODE='42501';END IF;
 SELECT deal_id INTO deal_id_value FROM public.staking_purchases WHERE id=p_purchase;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_funding_purchase_not_found';END IF;
 PERFORM id FROM public.staking_release_requests WHERE deal_id=deal_id_value ORDER BY id FOR UPDATE;
 had_release:=FOUND;
 SELECT * INTO d FROM public.staking_deals WHERE id=deal_id_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_funding_deal_not_found';END IF;
 IF NOT is_super AND (d.club_id IS NULL OR NOT public.is_club_cashier(p_actor,d.club_id))
 THEN RAISE EXCEPTION 'staking_funding_club_denied' USING ERRCODE='42501';END IF;
 IF NOT had_release AND EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=d.id)
 THEN RAISE EXCEPTION 'staking_funding_retry_snapshot' USING ERRCODE='40001';END IF;
 PERFORM id FROM public.staking_purchases WHERE deal_id=d.id ORDER BY id FOR UPDATE;
 SELECT * INTO p FROM public.staking_purchases WHERE id=p_purchase AND deal_id=d.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_funding_purchase_changed';END IF;
 intent:=jsonb_build_object('bank_tx_id',bank_value,'note',note_value);
 SELECT * INTO r FROM public.staking_funding_receipts_v1 WHERE purchase_id=p_purchase;
 IF FOUND THEN
  IF r.actor_id IS DISTINCT FROM p_actor OR r.payload IS DISTINCT FROM intent
  THEN RAISE EXCEPTION 'staking_funding_payload_conflict';END IF;
  RETURN r.response;
 END IF;
 IF p.status='funded' THEN RAISE EXCEPTION 'staking_funding_legacy_review_required';END IF;
 IF p.status<>'committed' OR d.status NOT IN('committing','committed')
 THEN RAISE EXCEPTION 'staking_funding_state_conflict';END IF;
 UPDATE public.staking_purchases SET status='funded',funded_at=now() WHERE id=p.id;
 INSERT INTO public.escrow_transactions(deal_id,transaction_type,amount_vnd,bank_tx_id,performed_by_admin_id,note)
 VALUES(d.id,'fund_lock',p.amount_vnd,coalesce(bank_value,p.reference_code),p_actor,
  coalesce(note_value,'VND funded purchase '||p.reference_code));
 SELECT coalesce(sum(percent) FILTER(WHERE status='committed'),0),coalesce(sum(percent) FILTER(WHERE status='funded'),0)
 INTO committed_total,funded_total FROM public.staking_purchases WHERE deal_id=d.id;
 IF committed_total=0 AND funded_total>0 AND (funded_total>=d.percentage_sold OR d.early_closed IS TRUE) THEN
  UPDATE public.staking_deals SET status='funded',escrow_locked_at=now(),filled_percent=funded_total WHERE id=d.id;
 END IF;
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(d.id,'admin_confirmed_funded',p_actor,d.status,(SELECT status FROM public.staking_deals WHERE id=d.id),
  jsonb_build_object('purchase_id',p.id,'backer_id',p.backer_id,'percent',p.percent,'amount_vnd',p.amount_vnd,
   'bank_tx_id',bank_value,'total_funded_percent',funded_total,'total_committed_percent',committed_total));
 outcome:=jsonb_build_object('success',true,'purchase_id',p.id,'purchase_status','funded',
  'deal_status',(SELECT status FROM public.staking_deals WHERE id=d.id),
  'total_funded_percent',funded_total,'total_committed_percent',committed_total);
 INSERT INTO public.staking_funding_receipts_v1(purchase_id,actor_id,payload,response) VALUES(p.id,p_actor,intent,outcome);
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.commit_staking_funding_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_staking_funding_v1(uuid,uuid,text,text) TO service_role;
COMMIT;
