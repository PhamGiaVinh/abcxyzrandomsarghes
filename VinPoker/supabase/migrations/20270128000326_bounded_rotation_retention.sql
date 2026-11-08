-- Bounded rotation-history cleanup; no schedule or immediate deletion here.
-- Preserve the deployed 24-hour superseded / 90-day terminal retention policy.
-- Recovery: stop the separate retention job first; restore captured functions
-- in a new reviewed migration. Deleted rows require the encrypted recovery copy.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid=to_regprocedure('public.cleanup_dealer_rotation_schedule(uuid,integer)')
      AND md5(replace(p.prosrc,chr(13),''))='3e7178f0024fe06a91986db17cf5828e'
      AND r.rolname='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=public']::text[])
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid=to_regprocedure('public.cleanup_next_dealer_rotation_schedule(integer)')
      AND md5(replace(p.prosrc,chr(13),''))='2bbb9842899288e3fde55969d48c5629'
      AND r.rolname='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=public']::text[]) THEN
    RAISE EXCEPTION 'rotation_retention_source_drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.idx_rotation_due')
    AND i.indisvalid AND i.indisready AND pg_get_indexdef(i.indexrelid)=
      'CREATE INDEX idx_rotation_due ON public.dealer_rotation_schedule USING btree (club_id, status, planned_relief_at)') THEN
    RAISE EXCEPTION 'rotation_retention_index_drift';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
      AND confrelid='public.dealer_rotation_schedule'::regclass)
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.dealer_rotation_schedule'::regclass
      AND NOT tgisinternal AND (tgtype&8)>0 AND tgenabled<>'D') THEN
    RAISE EXCEPTION 'rotation_retention_delete_dependencies_drift';
  END IF;
  IF has_function_privilege('anon','public.cleanup_dealer_rotation_schedule(uuid,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.cleanup_dealer_rotation_schedule(uuid,integer)','EXECUTE')
    OR has_function_privilege('anon','public.cleanup_next_dealer_rotation_schedule(integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.cleanup_next_dealer_rotation_schedule(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'rotation_retention_acl_drift';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cleanup_dealer_rotation_schedule(
  p_club_id uuid, p_batch_size integer DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_limit integer:=least(greatest(coalesce(p_batch_size,5000),1),5000);
  v_deleted integer:=0;
  v_status text;
  v_cutoff timestamptz;
BEGIN
  IF p_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome','error','detail','club_id is required');
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('rotation-retention:'||p_club_id::text,0)) THEN
    RETURN jsonb_build_object('outcome','busy','deleted',0,'batch_cap',v_limit);
  END IF;

  -- Four one-row index probes choose a status. A single-status range below
  -- lets LIMIT stop the index scan, without sorting the entire old history.
  SELECT policy.status,policy.cutoff INTO v_status,v_cutoff
  FROM (VALUES
    ('superseded'::text,now()-interval '24 hours'),
    ('executed'::text,now()-interval '90 days'),
    ('cancelled'::text,now()-interval '90 days'),
    ('no_show'::text,now()-interval '90 days')
  ) AS policy(status,cutoff)
  CROSS JOIN LATERAL (
    SELECT s.planned_relief_at FROM public.dealer_rotation_schedule s
    WHERE s.club_id=p_club_id AND s.status=policy.status AND s.planned_relief_at<policy.cutoff
    ORDER BY s.planned_relief_at LIMIT 1
  ) oldest
  ORDER BY oldest.planned_relief_at,policy.status LIMIT 1;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('outcome','no_work','club_id',p_club_id,'deleted',0,'batch_cap',v_limit);
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT s.ctid AS row_location FROM public.dealer_rotation_schedule s
    WHERE s.club_id=p_club_id AND s.status=v_status AND s.planned_relief_at<v_cutoff
    ORDER BY s.planned_relief_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  )
  -- Physical row locations live only inside this statement, after row locking.
  -- A TID scan avoids joining the small batch to all old rows of this status.
  DELETE FROM public.dealer_rotation_schedule target
  WHERE target.ctid=ANY(ARRAY(SELECT row_location FROM candidates)) AND target.club_id=p_club_id
    AND target.status=v_status AND target.planned_relief_at<v_cutoff;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  IF v_deleted>0 THEN
    RAISE LOG 'rotation_retention_cleanup club=% status=% deleted=%',p_club_id,v_status,v_deleted;
  END IF;
  RETURN jsonb_build_object('outcome',CASE WHEN v_deleted=0 THEN 'no_work' ELSE 'ok' END,
    'club_id',p_club_id,'deleted',v_deleted,'batch_cap',v_limit,'deleted_status',v_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_next_dealer_rotation_schedule(
  p_batch_size integer DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_limit integer:=least(greatest(coalesce(p_batch_size,5000),1),5000);
  v_club_id uuid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('rotation-retention-dispatch',0)) THEN
    RETURN jsonb_build_object('outcome','busy','deleted',0,'batch_cap',v_limit);
  END IF;
  SELECT c.id INTO v_club_id
  FROM public.clubs c
  CROSS JOIN (VALUES
    ('superseded'::text,now()-interval '24 hours'),
    ('executed'::text,now()-interval '90 days'),
    ('cancelled'::text,now()-interval '90 days'),
    ('no_show'::text,now()-interval '90 days')
  ) AS policy(status,cutoff)
  CROSS JOIN LATERAL (
    SELECT s.planned_relief_at FROM public.dealer_rotation_schedule s
    WHERE s.club_id=c.id AND s.status=policy.status AND s.planned_relief_at<policy.cutoff
    ORDER BY s.planned_relief_at LIMIT 1
  ) oldest
  ORDER BY oldest.planned_relief_at,c.id,policy.status LIMIT 1;
  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome','no_work','deleted',0,'batch_cap',v_limit);
  END IF;
  RETURN public.cleanup_dealer_rotation_schedule(v_club_id,v_limit);
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_dealer_rotation_schedule(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cleanup_next_dealer_rotation_schedule(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_dealer_rotation_schedule(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_next_dealer_rotation_schedule(integer) TO service_role;
COMMIT;
