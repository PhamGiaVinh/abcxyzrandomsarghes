-- Owner-gated performance patch. No managed net DDL, role/ACL, scheduler,
-- credential/endpoint, dealer business state or history retention changes.
-- Probe the existing response.created index first; unmatched pending requests
-- still use the complete original lookup, including late/clock-shifted replies.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'backup_observer_wrong_actor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.run_dealer_ready_backup_cron_v1()')
   AND md5(replace(prosrc,chr(13),''))='a6d8bd066c391bae16af4a82124024f9'
   AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""'])
   OR has_function_privilege('anon','public.run_dealer_ready_backup_cron_v1()','EXECUTE')
   OR has_function_privilege('authenticated','public.run_dealer_ready_backup_cron_v1()','EXECUTE')
   OR NOT has_function_privilege('service_role','public.run_dealer_ready_backup_cron_v1()','EXECUTE') THEN
   RAISE EXCEPTION 'backup_observer_predecessor_or_acl_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.dealer_ready_backup_cron_runs'::regclass
   AND relowner='postgres'::regrole AND relrowsecurity AND NOT relforcerowsecurity)
   OR to_regclass('public.dealer_ready_backup_pending_requested_idx') IS NOT NULL THEN
   RAISE EXCEPTION 'backup_observer_table_or_index_drift'; END IF;
END $guard$;
CREATE INDEX dealer_ready_backup_pending_requested_idx
 ON public.dealer_ready_backup_cron_runs(requested_at,request_id) WHERE result_state='pending';
DO $patch$
DECLARE
 target regprocedure:='public.run_dealer_ready_backup_cron_v1()'::regprocedure;
 definition text;
 previous_acl aclitem[];
 old_update text:=$update$  UPDATE public.dealer_ready_backup_cron_runs r
  SET response_status=h.status_code, observed_at=pg_catalog.now(),
      result_state=CASE WHEN NOT COALESCE(h.timed_out,false) AND h.status_code BETWEEN 200 AND 299
        THEN 'success' ELSE 'failed' END,
      error_code=CASE WHEN h.timed_out OR h.status_code IS NULL THEN 'timeout'
        WHEN h.status_code BETWEEN 200 AND 299 THEN NULL ELSE 'http_failed' END
  FROM net._http_response h WHERE h.id=r.request_id AND r.result_state='pending';$update$;
 fast_update text;
BEGIN
 SELECT replace(pg_get_functiondef(target),chr(13),''),proacl INTO STRICT definition,previous_acl
 FROM pg_proc WHERE oid=target;
 IF length(definition)-length(replace(definition,old_update,''))<>length(old_update)
   OR length(definition)-length(replace(definition,'  v_url text;',''))<>length('  v_url text;') THEN
   RAISE EXCEPTION 'backup_observer_patch_anchor_drift'; END IF;
 fast_update:=replace(old_update,'r.result_state=''pending'';','r.result_state=''pending'' AND h.created>=v_response_floor;');
 definition:=replace(definition,'  v_url text;',E'  v_url text;\n  v_response_floor timestamptz;');
 definition:=replace(definition,old_update,
   E'  SELECT min(requested_at) INTO v_response_floor\n  FROM public.dealer_ready_backup_cron_runs WHERE result_state=''pending'';\n  IF v_response_floor IS NOT NULL THEN\n'
   ||fast_update
   ||E'\n    IF EXISTS(SELECT 1 FROM public.dealer_ready_backup_cron_runs WHERE result_state=''pending'') THEN\n'
   ||old_update||E'\n    END IF;\n  END IF;');
 EXECUTE definition;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target
   AND proacl IS NOT DISTINCT FROM previous_acl AND proowner='postgres'::regrole
   AND prosecdef AND proconfig=ARRAY['search_path=""']) THEN
   RAISE EXCEPTION 'backup_observer_metadata_changed'; END IF;
END $patch$;
COMMIT;
