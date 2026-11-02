-- CLI candidate20261023163317 -> forward slot260. LOCAL, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_legacy_funding_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.commit_staking_legacy_funding_v1(uuid,uuid,text,bigint,text,text)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000260')
 THEN RAISE EXCEPTION 'staking260_catalog_collision';END IF;
END $$;
CREATE TABLE public.staking_legacy_funding_receipts_v1(
 deal_id uuid PRIMARY KEY REFERENCES public.staking_deals(id),actor_id uuid NOT NULL,
 payload jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staking_legacy_funding_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_legacy_funding_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.commit_staking_legacy_funding_v1(p_actor uuid,p_deal uuid,p_bank_tx text,p_amount bigint,p_proof text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE;r public.staking_legacy_funding_receipts_v1%ROWTYPE;
 intent jsonb;outcome jsonb;had_release boolean;changed_id uuid;
 bank_value text:=nullif(btrim(p_bank_tx),'');proof_value text:=nullif(btrim(p_proof),'');note_value text:=nullif(btrim(p_note),'');
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'staking_legacy_funding_service_required' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR p_deal IS NULL OR bank_value IS NULL OR length(bank_value)>200
 OR p_amount IS NULL OR p_amount<1 OR p_amount>10000000000 OR length(coalesce(proof_value,''))>2048
 OR (proof_value IS NOT NULL AND proof_value !~* '^https?://[^[:space:]]+$') OR length(coalesce(note_value,''))>1000
 THEN RAISE EXCEPTION 'staking_legacy_funding_invalid_payload';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin')
 THEN RAISE EXCEPTION 'staking_legacy_funding_forbidden' USING ERRCODE='42501';END IF;
 PERFORM id FROM public.staking_release_requests WHERE deal_id=p_deal ORDER BY id FOR UPDATE;had_release:=FOUND;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_legacy_funding_deal_not_found';END IF;
 IF NOT had_release AND EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=p_deal)
 THEN RAISE EXCEPTION 'staking_legacy_funding_retry_snapshot' USING ERRCODE='40001';END IF;
 PERFORM id FROM public.staking_purchases WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 -- Never fund a purchase-based deal twice via the old deal-level endpoint.
 IF FOUND THEN RAISE EXCEPTION 'staking_legacy_funding_purchase_flow_required';END IF;
 intent:=jsonb_build_object('bank_tx_id',bank_value,'amount_vnd',p_amount,'proof_image_url',proof_value,'note',note_value);
 SELECT * INTO r FROM public.staking_legacy_funding_receipts_v1 WHERE deal_id=p_deal;
 IF FOUND THEN
  IF r.actor_id IS DISTINCT FROM p_actor OR r.payload IS DISTINCT FROM intent
  THEN RAISE EXCEPTION 'staking_legacy_funding_payload_conflict';END IF;
  RETURN r.response;
 END IF;
 IF d.status<>'committed' OR d.backer_id IS NULL THEN RAISE EXCEPTION 'staking_legacy_funding_state_conflict';END IF;
 IF d.escrow_amount_vnd IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'staking_legacy_funding_amount_mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=p_deal AND transaction_type='fund_lock')
 THEN RAISE EXCEPTION 'staking_legacy_funding_legacy_review_required';END IF;
 INSERT INTO public.escrow_transactions(deal_id,transaction_type,amount_vnd,bank_tx_id,proof_image_url,performed_by_admin_id,note)
 VALUES(p_deal,'fund_lock',p_amount,bank_value,proof_value,p_actor,note_value);
 UPDATE public.staking_deals SET status='locked' WHERE id=p_deal AND status='committed' RETURNING id INTO changed_id;
 IF changed_id IS DISTINCT FROM p_deal THEN RAISE EXCEPTION 'staking_legacy_funding_write_unverified';END IF;
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(p_deal,'funded',p_actor,'committed','locked',intent);
 outcome:=jsonb_build_object('success',true,'deal_id',p_deal,'status','locked');
 INSERT INTO public.staking_legacy_funding_receipts_v1(deal_id,actor_id,payload,response) VALUES(p_deal,p_actor,intent,outcome);
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.commit_staking_legacy_funding_v1(uuid,uuid,text,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_staking_legacy_funding_v1(uuid,uuid,text,bigint,text,text) TO service_role;
COMMIT;
