-- Guarded code rollback only; never reverse inventory movements or historical counts.
DO $rollback$
DECLARE fn regprocedure:=to_regprocedure('public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)');
BEGIN
 IF fn IS NULL THEN RETURN; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=fn)<>'7a28ad11cdc51b0c54158498c8c5d759' THEN RAISE EXCEPTION 'stocktake_confirmed_rollback_body_drift'; END IF;
 DROP FUNCTION public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb);
END;
$rollback$;
