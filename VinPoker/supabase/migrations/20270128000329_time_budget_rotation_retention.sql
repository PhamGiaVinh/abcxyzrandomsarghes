-- Cooperative work budget for slow storage. Does not schedule or run cleanup.
-- Recovery: leave the retention job off; restore the captured predecessor in a
-- new migration. Never restore source rows over later legitimate writes.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
  IF current_user<>'postgres'
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cleanup_dealer_rotation_schedule(uuid,integer)')
      AND md5(replace(prosrc,chr(13),''))='bb691193de6f47b57014a6c44194db21')
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cleanup_next_dealer_rotation_schedule(integer)')
      AND md5(replace(prosrc,chr(13),''))='7719cb70ae682b03f92e12f6773aa193') THEN
    RAISE EXCEPTION 'rotation_retention_budget_predecessor_drift';
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-rotation-schedule') THEN
    RAISE EXCEPTION 'rotation_retention_job_must_be_stopped';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.idx_rotation_due')
    AND indisvalid AND indisready AND pg_get_indexdef(indexrelid)=
      'CREATE INDEX idx_rotation_due ON public.dealer_rotation_schedule USING btree (club_id, status, planned_relief_at)')
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.dealer_rotation_schedule'::regclass)
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.dealer_rotation_schedule'::regclass
      AND NOT tgisinternal AND (tgtype&8)>0 AND tgenabled<>'D') THEN
    RAISE EXCEPTION 'rotation_retention_budget_dependencies_drift';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cleanup_dealer_rotation_schedule(
  p_club_id uuid,p_batch_size integer DEFAULT 5000
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_limit integer:=least(greatest(coalesce(p_batch_size,5000),1),5000);
  v_deleted integer:=0;
  v_inspected integer:=0;
  v_rows integer;
  v_status text;
  v_cutoff timestamptz;
  v_started timestamptz:=clock_timestamp();
  v_deadline timestamptz:=v_started+interval '2 seconds';
  v_candidates refcursor;
  v_location tid;
BEGIN
  IF p_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome','error','detail','club_id is required');
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('rotation-retention:'||p_club_id::text,0)) THEN
    RETURN jsonb_build_object('outcome','busy','deleted',0,'batch_cap',v_limit);
  END IF;
  SELECT policy.status,policy.cutoff INTO v_status,v_cutoff
  FROM (VALUES
    ('superseded'::text,now()-interval '24 hours'),
    ('executed'::text,now()-interval '90 days'),
    ('cancelled'::text,now()-interval '90 days'),
    ('no_show'::text,now()-interval '90 days')
  ) policy(status,cutoff)
  CROSS JOIN LATERAL (
    SELECT s.planned_relief_at FROM public.dealer_rotation_schedule s
    WHERE s.club_id=p_club_id AND s.status=policy.status AND s.planned_relief_at<policy.cutoff
    ORDER BY s.planned_relief_at LIMIT 1
  ) oldest ORDER BY oldest.planned_relief_at,policy.status LIMIT 1;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('outcome','no_work','club_id',p_club_id,'deleted',0,'batch_cap',v_limit);
  END IF;
  -- Explicit FETCH avoids FOR-loop prefetch and materializing thousands of
  -- scattered heap reads before the first delete. One cursor scans once; do
  -- not restart the oldest-row index scan after each deletion.
  OPEN v_candidates NO SCROLL FOR
    SELECT s.ctid FROM public.dealer_rotation_schedule s
    WHERE s.club_id=p_club_id AND s.status=v_status AND s.planned_relief_at<v_cutoff
    ORDER BY s.planned_relief_at LIMIT v_limit;
  LOOP
    EXIT WHEN clock_timestamp()>=v_deadline;
    FETCH NEXT FROM v_candidates INTO v_location;
    EXIT WHEN NOT FOUND;
    v_inspected:=v_inspected+1;
    -- Physical locations never escape this transaction. Recheck the actual
    -- locked row's tenant/status/cutoff; a moved/updated tuple is not deleted.
    -- Locks are skipped only inside a one-location probe, so an all-locked
    -- history cannot make SKIP LOCKED walk beyond the candidate limit.
    WITH locked AS MATERIALIZED (
      SELECT s.ctid FROM public.dealer_rotation_schedule s
      WHERE s.ctid=v_location AND s.club_id=p_club_id
        AND s.status=v_status AND s.planned_relief_at<v_cutoff
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.dealer_rotation_schedule target
    WHERE target.ctid=ANY(ARRAY(SELECT ctid FROM locked)) AND target.club_id=p_club_id
      AND target.status=v_status AND target.planned_relief_at<v_cutoff;
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    v_deleted:=v_deleted+v_rows;
  END LOOP;
  CLOSE v_candidates;
  IF v_deleted>0 THEN
    RAISE LOG 'rotation_retention_cleanup club=% status=% deleted=%',p_club_id,v_status,v_deleted;
  END IF;
  RETURN jsonb_build_object('outcome',CASE WHEN v_deleted>0 THEN 'ok' ELSE 'deferred' END,
    'club_id',p_club_id,'deleted',v_deleted,'batch_cap',v_limit,'deleted_status',v_status,
    'inspected',v_inspected,'budget_ms',2000,
    'budget_exhausted',clock_timestamp()>=v_deadline,
    'elapsed_ms',extract(epoch FROM (clock_timestamp()-v_started))*1000);
  -- Budget is cooperative: one slow read/delete can overrun it. The caller's
  -- existing hard statement/lock timeouts still abort, never hide, that error.
END;
$function$;
REVOKE ALL ON FUNCTION public.cleanup_dealer_rotation_schedule(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_dealer_rotation_schedule(uuid,integer) TO service_role;
COMMIT;
