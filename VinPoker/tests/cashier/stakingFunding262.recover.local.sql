-- Optional LOCAL recovery only. Not executed: removes pending-read observation support, no data edits.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 IF md5(pg_get_functiondef('public.get_staking_funding_receipt_v1(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'adffc7f9952693170f0a29156f8c1b32'
 THEN RAISE EXCEPTION 'staking262_recovery_catalog_drift';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.get_staking_funding_receipt_v1(p_actor uuid,p_purchase uuid)
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
DO $$ BEGIN
 ASSERT md5(pg_get_functiondef('public.get_staking_funding_receipt_v1(uuid,uuid)'::regprocedure))='dfe2a87136065d8f4274fee0a9cb3087';
END $$;
COMMIT;
