-- Owner-gated observer-only performance patch. No managed DDL, scheduling,
-- enqueue, business state, leases, idempotency, credentials or privilege changes.
-- Sample wall-clock cutoff once immediately before response observation.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $patch$
DECLARE
 target regprocedure:='public.observe_process_swing_cron(integer)'::regprocedure;
 definition text;
 prior_acl aclitem[];
 prior_config text[];
 anchor text:=E'  WITH pending AS MATERIALIZED (';
 cutoff text:='clock_timestamp() - interval ''10 minutes''';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'swing_observer_wrong_actor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND proowner='postgres'::regrole AND prosecdef
  AND md5(replace(prosrc,chr(13),''))='3e89f851f0da636b01c57f819b8eef5f'
  AND proconfig=ARRAY['search_path=pg_catalog, public, net','statement_timeout=1s'])
  OR has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('authenticated',target,'EXECUTE')
  OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
  RAISE EXCEPTION 'swing_observer_source_or_boundary_drift'; END IF;
 SELECT replace(pg_get_functiondef(target),chr(13),''),proacl,proconfig INTO STRICT definition,prior_acl,prior_config
 FROM pg_proc WHERE oid=target;
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor)
  OR length(definition)-length(replace(definition,cutoff,''))<>2*length(cutoff)
  OR length(definition)-length(replace(definition,'  v_observed    integer := 0;',''))<>length('  v_observed    integer := 0;') THEN
  RAISE EXCEPTION 'swing_observer_patch_anchor_drift'; END IF;
 definition:=replace(definition,'  v_observed    integer := 0;',E'  v_observed    integer := 0;\n  v_observe_cutoff timestamptz;');
 definition:=replace(definition,anchor,E'  v_observe_cutoff := clock_timestamp() - interval ''10 minutes'';\n'||anchor);
 -- Replace only the two original predicate expressions, leaving assignment intact.
 definition:=replace(definition,'requested_at >= '||cutoff,'requested_at >= v_observe_cutoff');
 definition:=replace(definition,'response.created >= '||cutoff,'response.created >= v_observe_cutoff');
 EXECUTE definition;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND proowner='postgres'::regrole AND prosecdef
  AND proconfig IS NOT DISTINCT FROM prior_config AND proacl IS NOT DISTINCT FROM prior_acl) THEN
  RAISE EXCEPTION 'swing_observer_metadata_changed'; END IF;
END $patch$;
COMMIT;
