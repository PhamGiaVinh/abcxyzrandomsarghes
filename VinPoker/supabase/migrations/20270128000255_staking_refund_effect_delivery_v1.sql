-- CLI candidate20261023152431 -> forward255. LOCAL ONLY, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.staking_refund_email_intents_v1') IS NULL
 OR to_regprocedure('public.claim_staking_refund_email_v1(uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000255')
 THEN RAISE EXCEPTION 'staking255_catalog_drift';END IF;
END $$;
CREATE FUNCTION public._staking_refund_effect_authority_v1(p_actor uuid,p_request uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE club uuid;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_actor IS NULL OR p_request IS NULL
 THEN RAISE EXCEPTION 'staking_refund_effect_service_required' USING ERRCODE='42501';END IF;
 SELECT d.club_id INTO club FROM public.staking_refund_receipts_v1 r JOIN public.staking_deals d ON d.id=r.deal_id
 WHERE r.actor_id=p_actor AND r.request_id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_refund_effect_receipt_denied' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin')
 AND NOT (club IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='cashier')
 AND public.is_club_cashier(p_actor,club))
 THEN RAISE EXCEPTION 'staking_refund_effect_actor_denied' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION public.claim_staking_refund_email_v1(p_actor uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.staking_refund_email_intents_v1%ROWTYPE;
BEGIN
 PERFORM public._staking_refund_effect_authority_v1(p_actor,p_request);
 PERFORM 1 FROM public.staking_refund_receipts_v1 WHERE actor_id=p_actor AND request_id=p_request FOR UPDATE;
 -- An expired sender may already have reached the provider. Never reclaim for blind resend.
 UPDATE public.staking_refund_email_intents_v1 SET state='needs_attention',error_code='delivery_ack_unknown'
 WHERE actor_id=p_actor AND request_id=p_request AND state='processing' AND claimed_at<clock_timestamp()-interval '5 minutes';
 SELECT * INTO job FROM public.staking_refund_email_intents_v1
 WHERE actor_id=p_actor AND request_id=p_request AND state='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.staking_refund_email_intents_v1 SET state='processing',lease_token=gen_random_uuid(),claimed_at=clock_timestamp()
 WHERE id=job.id RETURNING * INTO job;
 RETURN jsonb_build_object('id',job.id,'purchase_id',job.purchase_id,'recipient_id',job.recipient_id,
 'lease_token',job.lease_token,'state',job.state,'payload',job.payload);
END $$;
CREATE FUNCTION public.finish_staking_refund_email_v1(p_actor uuid,p_request uuid,p_id uuid,p_token uuid,p_provider_id text,p_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.staking_refund_email_intents_v1%ROWTYPE;
BEGIN
 PERFORM public._staking_refund_effect_authority_v1(p_actor,p_request);
 IF p_token IS NULL OR ((p_provider_id IS NULL)=(p_error_code IS NULL))
 OR (p_provider_id IS NOT NULL AND length(btrim(p_provider_id)) NOT BETWEEN 1 AND 500)
 OR (p_error_code IS NOT NULL AND p_error_code NOT IN('delivery_failed_or_unknown','recipient_unavailable'))
 THEN RAISE EXCEPTION 'staking_refund_effect_ack_invalid';END IF;
 SELECT * INTO job FROM public.staking_refund_email_intents_v1
 WHERE id=p_id AND actor_id=p_actor AND request_id=p_request FOR UPDATE;
 IF NOT FOUND OR job.lease_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 IF job.state IN('delivered','needs_attention') THEN
  RETURN job.provider_id IS NOT DISTINCT FROM p_provider_id AND job.error_code IS NOT DISTINCT FROM p_error_code;
 END IF;
 IF job.state<>'processing' THEN RETURN false;END IF;
 IF job.claimed_at<clock_timestamp()-interval '5 minutes' THEN
  UPDATE public.staking_refund_email_intents_v1 SET state='needs_attention',error_code='delivery_ack_unknown' WHERE id=job.id;
  RETURN false;
 END IF;
 UPDATE public.staking_refund_email_intents_v1 SET state=CASE WHEN p_error_code IS NULL THEN 'delivered' ELSE 'needs_attention' END,
 provider_id=p_provider_id,error_code=p_error_code WHERE id=job.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._staking_refund_effect_authority_v1(uuid,uuid),public.claim_staking_refund_email_v1(uuid,uuid),
 public.finish_staking_refund_email_v1(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_staking_refund_email_v1(uuid,uuid),public.finish_staking_refund_email_v1(uuid,uuid,uuid,uuid,text,text) TO service_role;
COMMIT;
