-- Exact code-only inverse; downstream obligation/payment callers must be removed first.
-- Explicit guarded transaction; no CASCADE or financial data reversal.
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure) IS DISTINCT FROM '7ecfb3f082c03267ed728e9cb0648583' THEN RAISE EXCEPTION 'verified_funding_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_verified_funding_source_v1(uuid)'::regprocedure) IS DISTINCT FROM '99ce1551b75923a53fb9ac123a8db23b' THEN RAISE EXCEPTION 'verified_funding_down_body_drift';END IF;
END $guard$;
DROP FUNCTION private.multi_day_verified_funding_source_v1(uuid);
DROP FUNCTION private.multi_day_funding_evaluate_v1(uuid,jsonb);
