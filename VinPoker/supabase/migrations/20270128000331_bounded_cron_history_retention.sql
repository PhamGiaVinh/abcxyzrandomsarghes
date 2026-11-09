-- Source-only replacement. Scheduling requires a separately reviewed migration.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'cron_retention_wrong_actor'; END IF;
  -- Hosted maintenance actor already has BYPASSRLS. Do not grant it here.
  -- Without that existing capability, pg_cron's username RLS would make a
  -- global checkpoint incomplete and could turn MAX/page probes into long scans.
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'cron_retention_requires_existing_global_visibility';
  END IF;
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
      WHERE oid='public.cleanup_cron_job_run_details(integer)'::regprocedure)
      IS DISTINCT FROM 'ef9742555b7557160676b3463c50e9f8' THEN
    RAISE EXCEPTION 'cron_retention_predecessor_drift';
  END IF;
  IF NOT has_table_privilege(current_user,'cron.job_run_details','SELECT')
     OR NOT has_table_privilege(current_user,'cron.job_run_details','UPDATE')
     OR NOT has_table_privilege(current_user,'cron.job_run_details','DELETE')
     OR NOT EXISTS(SELECT 1 FROM pg_index
       WHERE indrelid='cron.job_run_details'::regclass AND indisprimary
         AND indisvalid AND indisready AND indnkeyatts=1
         AND pg_get_indexdef(indexrelid,1,true)='runid') THEN
    RAISE EXCEPTION 'cron_retention_privilege_or_index_drift';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE confrelid='cron.job_run_details'::regclass)
     OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='cron.job_run_details'::regclass
       AND NOT tgisinternal AND tgenabled<>'D' AND (tgtype::int & 8)=8)
     OR EXISTS(SELECT 1 FROM cron.job WHERE command LIKE '%cleanup_cron_job_run_details%') THEN
    RAISE EXCEPTION 'cron_retention_dependency_or_scheduler_drift';
  END IF;
END $guard$;

CREATE SCHEMA retention_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA retention_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE retention_private.cron_history_checkpoint(
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  scan_after bigint NOT NULL DEFAULT 0 CHECK(scan_after>=0),
  sweep_ceiling bigint CHECK(sweep_ceiling>=0),
  completed_sweeps bigint NOT NULL DEFAULT 0,
  total_inspected bigint NOT NULL DEFAULT 0,
  total_deleted bigint NOT NULL DEFAULT 0,
  last_inspected integer NOT NULL DEFAULT 0,
  last_deleted integer NOT NULL DEFAULT 0,
  last_work_ms numeric NOT NULL DEFAULT 0,
  last_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE retention_private.cron_history_checkpoint ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON retention_private.cron_history_checkpoint FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO retention_private.cron_history_checkpoint(singleton) VALUES(true);

CREATE OR REPLACE FUNCTION public.cleanup_cron_job_run_details(p_batch_size integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_limit integer:=least(greatest(coalesce(p_batch_size,5000),1),5000);
  v_after bigint;
  v_ceiling bigint;
  v_runid bigint;
  v_inspected integer:=0;
  v_deleted integer:=0;
  v_rows integer;
  v_complete boolean:=false;
  v_started timestamptz:=clock_timestamp();
  v_cursor refcursor;
BEGIN
  -- One transaction owns both the checkpoint and deletes. Failure rolls back
  -- both; repeated calls cannot skip committed source work after a crash.
  IF NOT pg_try_advisory_xact_lock(70331,1) THEN
    RETURN jsonb_build_object('outcome','busy','deleted',0,'inspected',0);
  END IF;
  SELECT scan_after,sweep_ceiling INTO STRICT v_after,v_ceiling
    FROM retention_private.cron_history_checkpoint WHERE singleton FOR UPDATE;
  IF v_ceiling IS NULL THEN
    SELECT coalesce(max(runid),0) INTO v_ceiling FROM cron.job_run_details;
  END IF;
  -- Scan the next PRIMARY KEY page, not the next matching old rows. A page of
  -- recent/running/unknown rows is bounded too. New rows cannot extend a sweep.
  OPEN v_cursor NO SCROLL FOR
    SELECT runid FROM cron.job_run_details
    WHERE runid>v_after AND runid<=v_ceiling ORDER BY runid LIMIT v_limit;
  LOOP
    EXIT WHEN v_inspected>=v_limit OR clock_timestamp()-v_started>=interval '2 seconds';
    FETCH v_cursor INTO v_runid;
    IF NOT FOUND THEN v_complete:=true; EXIT; END IF;
    v_inspected:=v_inspected+1;
    v_after:=v_runid;
    -- Recheck eligibility after locking the current row version. Null dates,
    -- unknown statuses and incomplete runs survive and are revisited next sweep.
    WITH locked AS MATERIALIZED(
      SELECT runid FROM cron.job_run_details
      WHERE runid=v_runid AND start_time<now()-interval '7 days'
        AND end_time IS NOT NULL AND status IN('succeeded','failed')
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM cron.job_run_details d USING locked l WHERE d.runid=l.runid
      AND d.start_time<now()-interval '7 days' AND d.end_time IS NOT NULL
      AND d.status IN('succeeded','failed');
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    v_deleted:=v_deleted+v_rows;
  END LOOP;
  CLOSE v_cursor;
  v_complete:=v_complete OR v_after>=v_ceiling;
  UPDATE retention_private.cron_history_checkpoint SET
    scan_after=CASE WHEN v_complete THEN 0 ELSE v_after END,
    sweep_ceiling=CASE WHEN v_complete THEN NULL ELSE v_ceiling END,
    completed_sweeps=completed_sweeps+CASE WHEN v_complete THEN 1 ELSE 0 END,
    total_inspected=total_inspected+v_inspected,total_deleted=total_deleted+v_deleted,
    last_inspected=v_inspected,last_deleted=v_deleted,
    last_work_ms=extract(epoch FROM(clock_timestamp()-v_started))*1000,
    last_started_at=v_started,
    updated_at=clock_timestamp() WHERE singleton;
  RETURN jsonb_build_object('outcome',CASE WHEN v_deleted>0 THEN 'ok' ELSE 'deferred' END,
    'deleted',v_deleted,'inspected',v_inspected,'batch_cap',v_limit,
    'scan_after',CASE WHEN v_complete THEN 0 ELSE v_after END,
    'sweep_complete',v_complete,'elapsed_ms',extract(epoch FROM(clock_timestamp()-v_started))*1000);
END $function$;
REVOKE ALL ON FUNCTION public.cleanup_cron_job_run_details(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_cron_job_run_details(integer) TO service_role;
COMMIT;
