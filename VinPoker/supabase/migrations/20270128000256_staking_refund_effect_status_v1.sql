-- CLI candidate20261023152807 -> forward256. LOCAL ONLY, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public._staking_refund_effect_authority_v1(uuid,uuid)') IS NULL
 OR to_regprocedure('public.get_staking_refund_email_status_v1(uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000256')
 THEN RAISE EXCEPTION 'staking256_catalog_drift';END IF;
END $$;
CREATE FUNCTION public.get_staking_refund_email_status_v1(p_actor uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.staking_refund_receipts_v1%ROWTYPE; expected integer;
 total bigint; delivered bigint; pending bigint; processing bigint; attention bigint; missing boolean;
BEGIN
 PERFORM public._staking_refund_effect_authority_v1(p_actor,p_request);
 SELECT * INTO STRICT r FROM public.staking_refund_receipts_v1 WHERE actor_id=p_actor AND request_id=p_request;
 expected:=(r.response->>'refunded_backers')::integer;
 SELECT count(*),count(*) FILTER(WHERE state='delivered'),count(*) FILTER(WHERE state='pending'),
 count(*) FILTER(WHERE state='processing' AND claimed_at>=statement_timestamp()-interval '5 minutes'),
 count(*) FILTER(WHERE state='needs_attention' OR (state='processing' AND (claimed_at IS NULL OR claimed_at<statement_timestamp()-interval '5 minutes')))
 INTO total,delivered,pending,processing,attention FROM public.staking_refund_email_intents_v1
 WHERE actor_id=p_actor AND request_id=p_request AND deal_id=r.deal_id;
 missing:=expected IS NULL OR total<>expected;
 RETURN jsonb_build_object('request_id',p_request,'deal_id',r.deal_id,'expected',expected,'total',total,
 'delivered',delivered,'pending',pending,'processing',processing,'needs_attention',attention,'evidence_missing',missing,
 'state',CASE WHEN missing OR attention>0 THEN 'needs_attention' WHEN pending+processing>0 THEN 'pending' ELSE 'all_delivered' END);
END $$;
REVOKE ALL ON FUNCTION public.get_staking_refund_email_status_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_refund_email_status_v1(uuid,uuid) TO service_role;
COMMIT;
