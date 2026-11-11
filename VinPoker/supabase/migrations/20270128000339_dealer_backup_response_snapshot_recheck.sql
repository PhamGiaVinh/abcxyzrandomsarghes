-- Preserve the full reply lookup, including NULL/old/clock-shifted timestamps.
-- The exhaustive timestamp predicate permits use of the managed created index
-- on a sparse/bloated heap without changing managed objects or forcing plans.
-- Recheck absence in the timeout statement's snapshot: a reply committed during
-- the preceding observation must remain pending for the next observation.
-- This cannot prevent a reply arriving after the final timeout snapshot.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $patch$
DECLARE
 target regprocedure:='public.run_dealer_ready_backup_cron_v1()'::regprocedure;
 definition text;
 previous_acl aclitem[];
 old_lookup text:=$lookup$FROM net._http_response h WHERE h.id=r.request_id AND r.result_state='pending';$lookup$;
 old_timeout text:=$timeout$  UPDATE public.dealer_ready_backup_cron_runs
  SET result_state='failed',error_code='timeout',observed_at=pg_catalog.now()
  WHERE result_state='pending' AND requested_at < pg_catalog.now()-interval '2 minutes';$timeout$;
 new_timeout text:=$timeout$  UPDATE public.dealer_ready_backup_cron_runs r
  SET result_state='failed',error_code='timeout',observed_at=pg_catalog.now()
  WHERE r.result_state='pending' AND r.requested_at < pg_catalog.now()-interval '2 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM net._http_response h WHERE h.id=r.request_id
        AND (h.created >= '-infinity'::timestamptz OR h.created IS NULL)
    );$timeout$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'backup_snapshot_wrong_actor'; END IF;
 SELECT replace(pg_get_functiondef(target),chr(13),''),proacl INTO STRICT definition,previous_acl
 FROM pg_proc WHERE oid=target
 AND md5(replace(prosrc,chr(13),''))='e22dfb9b8be475834140b66f877203e1'
 AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""'];
 IF has_function_privilege('anon',target,'EXECUTE')
 OR has_function_privilege('authenticated',target,'EXECUTE')
 OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
   RAISE EXCEPTION 'backup_snapshot_acl_drift'; END IF;
 IF length(definition)-length(replace(definition,old_lookup,''))<>length(old_lookup)
 OR length(definition)-length(replace(definition,old_timeout,''))<>length(old_timeout) THEN
   RAISE EXCEPTION 'backup_snapshot_anchor_drift'; END IF;
 definition:=replace(definition,old_lookup,
   'FROM net._http_response h WHERE h.id=r.request_id AND r.result_state=''pending'''
   ||' AND (h.created >= ''-infinity''::timestamptz OR h.created IS NULL);');
 definition:=replace(definition,old_timeout,new_timeout);
 EXECUTE definition;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target
 AND proacl IS NOT DISTINCT FROM previous_acl AND proowner='postgres'::regrole
 AND prosecdef AND proconfig=ARRAY['search_path=""']) THEN
   RAISE EXCEPTION 'backup_snapshot_metadata_changed'; END IF;
END $patch$;
COMMIT;
