-- Replace the observed timed-out global club/policy frontier with one bounded
-- primary-key sweep. Requires331 private maintenance schema, schedules nothing.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
 IF current_user<>'postgres'
    OR NOT EXISTS(SELECT 1 FROM pg_proc
      WHERE oid='public.cleanup_next_dealer_rotation_schedule(integer)'::regprocedure
        AND md5(replace(prosrc,chr(13),''))='7719cb70ae682b03f92e12f6773aa193')
    OR NOT EXISTS(SELECT 1 FROM pg_namespace
      WHERE nspname='retention_private' AND nspowner='postgres'::regrole)
    OR to_regclass('retention_private.cron_history_checkpoint') IS NULL THEN
   RAISE EXCEPTION 'rotation_checkpoint_predecessor_or_dependency_drift'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-rotation-schedule') THEN
   RAISE EXCEPTION 'rotation_checkpoint_job_must_be_stopped'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index
      WHERE indrelid='public.dealer_rotation_schedule'::regclass AND indisprimary
        AND indisvalid AND indisready AND indnkeyatts=1
        AND pg_get_indexdef(indexrelid,1,true)='id')
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE confrelid='public.dealer_rotation_schedule'::regclass)
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.dealer_rotation_schedule'::regclass
       AND NOT tgisinternal AND tgenabled<>'D' AND(tgtype::int&8)=8) THEN
   RAISE EXCEPTION 'rotation_checkpoint_index_or_dependencies_drift'; END IF;
END $guard$;
CREATE TABLE retention_private.rotation_checkpoint(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 scan_after uuid,sweep_ceiling uuid,
 completed_sweeps bigint NOT NULL DEFAULT 0,
 total_inspected bigint NOT NULL DEFAULT 0,total_deleted bigint NOT NULL DEFAULT 0,
 last_inspected integer NOT NULL DEFAULT 0,last_deleted integer NOT NULL DEFAULT 0,
 last_work_ms numeric NOT NULL DEFAULT 0,last_started_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE retention_private.rotation_checkpoint ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON retention_private.rotation_checkpoint FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO retention_private.rotation_checkpoint(singleton) VALUES(true);

CREATE OR REPLACE FUNCTION public.cleanup_next_dealer_rotation_schedule(p_batch_size integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_limit integer:=least(greatest(coalesce(p_batch_size,5000),1),5000);
 v_after uuid; v_ceiling uuid; v_id uuid; v_club uuid; v_status text;
 v_cutoff timestamptz;
 v_inspected integer:=0; v_deleted integer:=0; v_rows integer;
 v_complete boolean:=false;v_started timestamptz:=clock_timestamp();v_cursor refcursor;
BEGIN
 IF NOT pg_try_advisory_xact_lock(70333,1) THEN
   RETURN jsonb_build_object('outcome','busy','deleted',0,'inspected',0);
 END IF;
 SELECT scan_after,sweep_ceiling INTO STRICT v_after,v_ceiling
 FROM retention_private.rotation_checkpoint WHERE singleton FOR UPDATE;
 IF v_ceiling IS NULL THEN
   SELECT id INTO v_ceiling FROM public.dealer_rotation_schedule ORDER BY id DESC LIMIT 1;
 END IF;
 -- No eligibility filter here: a page of current/locked/null rows stays
 -- bounded too. UUID inserts behind this cursor are revisited next sweep.
 IF v_after IS NULL THEN
   OPEN v_cursor NO SCROLL FOR SELECT id,club_id,status
   FROM public.dealer_rotation_schedule WHERE id<=v_ceiling ORDER BY id LIMIT v_limit;
 ELSE
   OPEN v_cursor NO SCROLL FOR SELECT id,club_id,status
   FROM public.dealer_rotation_schedule WHERE id>v_after AND id<=v_ceiling ORDER BY id LIMIT v_limit;
 END IF;
 LOOP
   EXIT WHEN v_inspected>=v_limit OR clock_timestamp()-v_started>=interval '2 seconds';
   FETCH v_cursor INTO v_id,v_club,v_status;
   IF NOT FOUND THEN v_complete:=true; EXIT; END IF;
   v_inspected:=v_inspected+1; v_after:=v_id;
   IF v_club IS NULL OR v_status IS NULL
      OR v_status NOT IN('superseded','executed','cancelled','no_show') THEN CONTINUE; END IF;
   v_cutoff:=now()-CASE WHEN v_status='superseded' THEN interval '24 hours' ELSE interval '90 days' END;
   WITH locked AS MATERIALIZED(
     SELECT id FROM public.dealer_rotation_schedule
     WHERE id=v_id AND club_id=v_club AND status=v_status AND planned_relief_at<v_cutoff
     FOR UPDATE SKIP LOCKED
   )
   DELETE FROM public.dealer_rotation_schedule d USING locked l
   WHERE d.id=l.id AND d.club_id=v_club AND d.status=v_status AND d.planned_relief_at<v_cutoff;
   GET DIAGNOSTICS v_rows=ROW_COUNT;v_deleted:=v_deleted+v_rows;
 END LOOP;
 CLOSE v_cursor;
 v_complete:=v_complete OR v_ceiling IS NULL OR coalesce(v_after>=v_ceiling,false);
 UPDATE retention_private.rotation_checkpoint SET
   scan_after=CASE WHEN v_complete THEN NULL ELSE v_after END,
   sweep_ceiling=CASE WHEN v_complete THEN NULL ELSE v_ceiling END,
   completed_sweeps=completed_sweeps+CASE WHEN v_complete THEN 1 ELSE 0 END,
   total_inspected=total_inspected+v_inspected,total_deleted=total_deleted+v_deleted,
   last_inspected=v_inspected,last_deleted=v_deleted,
   last_work_ms=extract(epoch FROM(clock_timestamp()-v_started))*1000,
   last_started_at=v_started,updated_at=clock_timestamp() WHERE singleton;
 RETURN jsonb_build_object('outcome',CASE WHEN v_deleted>0 THEN 'ok' ELSE 'deferred' END,
   'deleted',v_deleted,'inspected',v_inspected,'batch_cap',v_limit,'sweep_complete',v_complete,
   'scan_after',CASE WHEN v_complete THEN NULL ELSE v_after END,
   'elapsed_ms',extract(epoch FROM(clock_timestamp()-v_started))*1000);
END $function$;
REVOKE ALL ON FUNCTION public.cleanup_next_dealer_rotation_schedule(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_next_dealer_rotation_schedule(integer) TO service_role;
COMMIT;
