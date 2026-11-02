-- CLIcandidate20261023161113 -> forward259. LOCAL ONLY, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.staking_funding_email_intents_v1') IS NULL
 OR to_regprocedure('public.claim_staking_funding_email_v1(uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000259')
 THEN RAISE EXCEPTION 'staking259_catalog_drift';END IF;
END $$;
CREATE FUNCTION public._staking_funding_effect_authority_v1(p_actor uuid,p_purchase uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE club uuid;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_actor IS NULL OR p_purchase IS NULL
 THEN RAISE EXCEPTION 'staking_funding_effect_service_required' USING ERRCODE='42501';END IF;
 SELECT d.club_id INTO club FROM public.staking_funding_receipts_v1 r JOIN public.staking_purchases p ON p.id=r.purchase_id
 JOIN public.staking_deals d ON d.id=p.deal_id WHERE r.purchase_id=p_purchase AND r.actor_id=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_funding_effect_receipt_denied' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin')
 AND (club IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='cashier')
 AND public.is_club_cashier(p_actor,club)) IS NOT TRUE
 THEN RAISE EXCEPTION 'staking_funding_effect_actor_denied' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION public.claim_staking_funding_email_v1(p_actor uuid,p_purchase uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.staking_funding_email_intents_v1%ROWTYPE;
BEGIN
 PERFORM public._staking_funding_effect_authority_v1(p_actor,p_purchase);
 PERFORM 1 FROM public.staking_funding_receipts_v1 WHERE purchase_id=p_purchase FOR UPDATE;
 UPDATE public.staking_funding_email_intents_v1 SET state='needs_attention',error_code='delivery_ack_unknown'
 WHERE purchase_id=p_purchase AND actor_id=p_actor AND state='processing' AND (claimed_at IS NULL OR claimed_at<clock_timestamp()-interval '5 minutes');
 SELECT * INTO job FROM public.staking_funding_email_intents_v1 WHERE purchase_id=p_purchase AND actor_id=p_actor AND state='pending'
 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.staking_funding_email_intents_v1 SET state='processing',lease_token=gen_random_uuid(),claimed_at=clock_timestamp()
 WHERE id=job.id RETURNING * INTO job;
 RETURN jsonb_build_object('id',job.id,'purchase_id',job.purchase_id,'recipient_id',job.recipient_id,'recipient_role',job.recipient_role,
 'lease_token',job.lease_token,'state',job.state,'payload',job.payload);
END $$;
CREATE FUNCTION public.finish_staking_funding_email_v1(p_actor uuid,p_purchase uuid,p_id uuid,p_token uuid,p_provider_id text,p_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.staking_funding_email_intents_v1%ROWTYPE;
BEGIN
 PERFORM public._staking_funding_effect_authority_v1(p_actor,p_purchase);
 IF p_token IS NULL OR ((p_provider_id IS NULL)=(p_error_code IS NULL))
 OR (p_provider_id IS NOT NULL AND length(btrim(p_provider_id)) NOT BETWEEN 1 AND 500)
 OR (p_error_code IS NOT NULL AND p_error_code NOT IN('delivery_failed_or_unknown','recipient_unavailable'))
 THEN RAISE EXCEPTION 'staking_funding_effect_ack_invalid';END IF;
 SELECT * INTO job FROM public.staking_funding_email_intents_v1 WHERE id=p_id AND purchase_id=p_purchase AND actor_id=p_actor FOR UPDATE;
 IF NOT FOUND OR job.lease_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 IF job.state IN('delivered','needs_attention') THEN RETURN job.provider_id IS NOT DISTINCT FROM p_provider_id AND job.error_code IS NOT DISTINCT FROM p_error_code;END IF;
 IF job.state<>'processing' THEN RETURN false;END IF;
 IF job.claimed_at IS NULL OR job.claimed_at<clock_timestamp()-interval '5 minutes' THEN
  UPDATE public.staking_funding_email_intents_v1 SET state='needs_attention',error_code='delivery_ack_unknown' WHERE id=job.id;RETURN false;
 END IF;
 UPDATE public.staking_funding_email_intents_v1 SET state=CASE WHEN p_error_code IS NULL THEN 'delivered' ELSE 'needs_attention' END,
 provider_id=p_provider_id,error_code=p_error_code WHERE id=job.id;RETURN true;
END $$;
CREATE FUNCTION public.get_staking_funding_email_status_v1(p_actor uuid,p_purchase uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE total bigint;delivered bigint;pending bigint;processing bigint;attention bigint;
BEGIN
 PERFORM public._staking_funding_effect_authority_v1(p_actor,p_purchase);
 SELECT count(*),count(*) FILTER(WHERE state='delivered'),count(*) FILTER(WHERE state='pending'),
 count(*) FILTER(WHERE state='processing' AND claimed_at>=statement_timestamp()-interval '5 minutes'),
 count(*) FILTER(WHERE state='needs_attention' OR (state='processing' AND (claimed_at IS NULL OR claimed_at<statement_timestamp()-interval '5 minutes')))
 INTO total,delivered,pending,processing,attention FROM public.staking_funding_email_intents_v1 WHERE purchase_id=p_purchase AND actor_id=p_actor;
 RETURN jsonb_build_object('purchase_id',p_purchase,'expected',2,'total',total,'delivered',delivered,'pending',pending,'processing',processing,
 'needs_attention',attention,'evidence_missing',total<>2,'state',CASE WHEN total<>2 OR attention>0 THEN 'needs_attention'
 WHEN pending+processing>0 THEN 'pending' ELSE 'all_delivered' END);
END $$;
REVOKE ALL ON FUNCTION public._staking_funding_effect_authority_v1(uuid,uuid),public.claim_staking_funding_email_v1(uuid,uuid),
 public.finish_staking_funding_email_v1(uuid,uuid,uuid,uuid,text,text),public.get_staking_funding_email_status_v1(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_staking_funding_email_v1(uuid,uuid),public.finish_staking_funding_email_v1(uuid,uuid,uuid,uuid,text,text),
 public.get_staking_funding_email_status_v1(uuid,uuid) TO service_role;
COMMIT;
