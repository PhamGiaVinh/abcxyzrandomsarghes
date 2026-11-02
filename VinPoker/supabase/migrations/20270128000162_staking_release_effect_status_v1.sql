-- CLI candidate20261018171053 ->162, LOCAL only. Read state, never resend/repair.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.get_staking_release_effect_status_v1(uuid)') IS NOT NULL
 OR to_regclass('public.staking_release_effects_v1') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000162')
 THEN RAISE EXCEPTION 'staking162_catalog_collision';END IF;
END $$;
CREATE FUNCTION public._staking_release_effect_status_v1(p_actor uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE club uuid; deal uuid; n integer; delivered integer; pending integer; processing integer; held integer;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role IN('cashier','super_admin'))
 THEN RAISE EXCEPTION 'staking_status_forbidden' USING ERRCODE='42501';END IF;
 SELECT d.club_id,d.id INTO club,deal FROM public.staking_release_requests r JOIN public.staking_deals d ON d.id=r.deal_id WHERE r.id=p_request;
 IF NOT FOUND OR (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin')
  AND (club IS NULL OR NOT public.is_club_cashier(p_actor,club)))
 THEN RAISE EXCEPTION 'staking_status_forbidden' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staking_release_receipts_v1 WHERE release_request_id=p_request)
 THEN RETURN jsonb_build_object('release_request_id',p_request,'deal_id',deal,'state','financial_not_verified');END IF;
 SELECT count(*),count(*) FILTER(WHERE state='delivered'),count(*) FILTER(WHERE state='pending'),
  count(*) FILTER(WHERE state='processing' AND lease_expires_at>=statement_timestamp()),
  count(*) FILTER(WHERE state='needs_attention' OR (state='processing' AND (lease_expires_at IS NULL OR lease_expires_at<statement_timestamp())))
 INTO n,delivered,pending,processing,held FROM public.staking_release_effects_v1 WHERE release_request_id=p_request;
 RETURN jsonb_build_object('release_request_id',p_request,'deal_id',deal,
  'state',CASE WHEN held>0 OR n=0 THEN 'needs_attention' WHEN pending+processing>0 THEN 'pending' ELSE 'all_delivered' END,
  'total',n,'delivered',delivered,'pending',pending,'processing',processing,'needs_attention',held,
  'evidence_missing',n=0);
END $$;
REVOKE ALL ON FUNCTION public._staking_release_effect_status_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_staking_release_effect_status_v1(p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public._staking_release_effect_status_v1(auth.uid(),p_request);
$$;
REVOKE ALL ON FUNCTION public.get_staking_release_effect_status_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_release_effect_status_v1(uuid) TO authenticated;
CREATE FUNCTION public.get_staking_release_effect_status_for_actor_v1(p_actor uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 RETURN public._staking_release_effect_status_v1(p_actor,p_request);
END $$;
REVOKE ALL ON FUNCTION public.get_staking_release_effect_status_for_actor_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_release_effect_status_for_actor_v1(uuid,uuid) TO service_role;
COMMIT;
