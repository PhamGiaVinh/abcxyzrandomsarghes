-- CLI candidate20261023173344 -> reserved forward262. LOCAL ONLY / NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000262')
 OR md5(pg_get_functiondef('public.get_staking_funding_receipt_v1(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'dfe2a87136065d8f4274fee0a9cb3087'
 OR md5(pg_get_functiondef('public._staking_funding_effect_authority_v1(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'fed5b9db6ef77bf3591268fc80036286'
 THEN RAISE EXCEPTION 'staking262_catalog_drift';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.get_staking_funding_receipt_v1(p_actor uuid,p_purchase uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb;receipt_actor uuid;club uuid;purchase_state text;deal_state text;is_super boolean;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_actor IS NULL OR p_purchase IS NULL
 THEN RAISE EXCEPTION 'staking_funding_read_service_required' USING ERRCODE='42501';END IF;
 SELECT d.club_id,p.status::text,d.status::text INTO club,purchase_state,deal_state
 FROM public.staking_purchases p JOIN public.staking_deals d ON d.id=p.deal_id WHERE p.id=p_purchase;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_funding_read_denied' USING ERRCODE='42501';END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin') INTO is_super;
 IF NOT is_super AND (club IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='cashier')
 AND public.is_club_cashier(p_actor,club)) IS NOT TRUE
 THEN RAISE EXCEPTION 'staking_funding_read_denied' USING ERRCODE='42501';END IF;
 SELECT response,actor_id INTO receipt,receipt_actor FROM public.staking_funding_receipts_v1 WHERE purchase_id=p_purchase;
 IF FOUND THEN
  -- Preserve original actor-bound receipt authority; never adopt another actor's write.
  PERFORM public._staking_funding_effect_authority_v1(p_actor,p_purchase);
  IF receipt_actor IS DISTINCT FROM p_actor OR receipt->>'success' IS DISTINCT FROM 'true'
  OR receipt->>'purchase_id' IS DISTINCT FROM p_purchase::text OR receipt->>'purchase_status' IS DISTINCT FROM 'funded'
  THEN RAISE EXCEPTION 'staking_funding_read_receipt_unverified';END IF;
  RETURN receipt||jsonb_build_object('delivery',public.get_staking_funding_email_status_v1(p_actor,p_purchase));
 END IF;
 -- A snapshot observation, NOT permission to retry with a new identity. Never claim/send/mutate.
 -- Legacy funds not covered by canonical receipts require reconciliation, not another fund_lock.
 IF purchase_state<>'committed' OR deal_state NOT IN('committing','committed')
 OR EXISTS(
  SELECT 1 FROM public.staking_purchases p WHERE p.id=p_purchase AND (
   (SELECT count(*) FROM public.escrow_transactions e WHERE e.deal_id=p.deal_id AND e.transaction_type='fund_lock')
   <> (SELECT count(*) FROM public.staking_funding_receipts_v1 r JOIN public.staking_purchases rp ON rp.id=r.purchase_id WHERE rp.deal_id=p.deal_id)
   OR (SELECT coalesce(sum(e.amount_vnd),0) FROM public.escrow_transactions e WHERE e.deal_id=p.deal_id AND e.transaction_type='fund_lock')
   <> (SELECT coalesce(sum(rp.amount_vnd),0) FROM public.staking_funding_receipts_v1 r JOIN public.staking_purchases rp ON rp.id=r.purchase_id WHERE rp.deal_id=p.deal_id)
  )
 ) THEN RETURN jsonb_build_object('success',false,'purchase_id',p_purchase,'state','needs_attention');END IF;
 RETURN jsonb_build_object('success',false,'purchase_id',p_purchase,'state','not_recorded');
END $$;
REVOKE ALL ON FUNCTION public.get_staking_funding_receipt_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_funding_receipt_v1(uuid,uuid) TO service_role;
COMMIT;
