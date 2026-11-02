-- CLI candidate20261023172222 -> forward261. LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.get_staking_funding_receipt_v1(uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000261')
 OR to_regclass('public.staking_funding_receipts_v1') IS NULL
 OR md5(pg_get_functiondef('public._staking_funding_effect_authority_v1(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'fed5b9db6ef77bf3591268fc80036286'
 OR md5(pg_get_functiondef('public.get_staking_funding_email_status_v1(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'a74dd4db0e4ad8285b7dc3086ac0f0d0'
 THEN RAISE EXCEPTION 'staking261_catalog_drift';END IF;
END $$;
CREATE FUNCTION public.get_staking_funding_receipt_v1(p_actor uuid,p_purchase uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb;
BEGIN
 PERFORM public._staking_funding_effect_authority_v1(p_actor,p_purchase);
 SELECT response INTO receipt FROM public.staking_funding_receipts_v1 WHERE purchase_id=p_purchase AND actor_id=p_actor;
 IF receipt->>'success' IS DISTINCT FROM 'true' OR receipt->>'purchase_id' IS DISTINCT FROM p_purchase::text
 OR receipt->>'purchase_status' IS DISTINCT FROM 'funded'
 THEN RAISE EXCEPTION 'staking_funding_read_receipt_unverified';END IF;
 -- Historical financial receipt plus current delivery snapshot; never claim/finish/send.
 RETURN receipt||jsonb_build_object('delivery',public.get_staking_funding_email_status_v1(p_actor,p_purchase));
END $$;
REVOKE ALL ON FUNCTION public.get_staking_funding_receipt_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_funding_receipt_v1(uuid,uuid) TO service_role;
COMMIT;
