-- CLI candidate20261023145344 -> forward slot252. LOCAL candidate, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.commit_staking_purchase_v2(uuid,uuid,uuid,integer)') IS NOT NULL
 OR to_regprocedure('public.commit_staking_purchase_v1(uuid,uuid,uuid,integer)') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000252')
 THEN RAISE EXCEPTION 'staking252_catalog_drift';END IF;
END $$;
CREATE FUNCTION public.commit_staking_purchase_v2(p_actor uuid,p_request uuid,p_deal uuid,p_percent integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; stamp timestamptz;
BEGIN
 -- v1 performs the service/actor/scope/receipt checks and holds canonical row locks.
 result:=public.commit_staking_purchase_v1(p_actor,p_request,p_deal,p_percent);
 SELECT committed_at INTO stamp FROM public.staking_purchases
 WHERE id=(result->>'purchase_id')::uuid AND deal_id=p_deal AND backer_id=p_actor;
 IF stamp IS NULL THEN RAISE EXCEPTION 'staking_purchase_original_time_required';END IF;
 RETURN result||jsonb_build_object('committed_at',stamp);
END $$;
REVOKE ALL ON FUNCTION public.commit_staking_purchase_v2(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_staking_purchase_v2(uuid,uuid,uuid,integer) TO service_role;
COMMIT;
