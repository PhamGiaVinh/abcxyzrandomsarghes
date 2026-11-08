BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $$ BEGIN
 IF md5(replace(pg_get_functiondef('public.get_public_player_hud_summary_v1(uuid,uuid,text)'::regprocedure),chr(13),''))
  IS DISTINCT FROM '0f3feed28a4e3711ed2d4e7511e1ca26'
 THEN RAISE EXCEPTION 'hud_summary_batch_dependency_drift'; END IF;
END $$;

-- One scope and one current statement snapshot. Only the previous access
-- snapshot differs between participants; no results are cached between calls.
CREATE FUNCTION public.get_public_player_hud_summary_batch_v1(
 p_tournament_id uuid,p_player_id uuid,p_access_snapshots text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE shared jsonb; checks jsonb:='[]'::jsonb; previous text;
 parsed pg_snapshot; valid boolean; changed boolean;
BEGIN
 IF p_access_snapshots IS NULL OR cardinality(p_access_snapshots) NOT BETWEEN 1 AND 64
  OR array_ndims(p_access_snapshots) IS DISTINCT FROM 1 OR array_lower(p_access_snapshots,1)<>1
  OR (SELECT coalesce(sum(octet_length(s)),0) FROM unnest(p_access_snapshots) s)>16384
 THEN RAISE EXCEPTION 'invalid_snapshot_batch' USING ERRCODE='22023'; END IF;
 shared:=public.get_public_player_hud_summary_v1(p_tournament_id,p_player_id,NULL);
 FOREACH previous IN ARRAY p_access_snapshots LOOP
  valid:=coalesce(length(previous)<=8192,true);changed:=false;
  -- Preserve the scalar early outcomes: unavailable/warming/revoked do not
  -- parse a snapshot. The scalar length bound applies before those outcomes.
  IF valid AND previous IS NOT NULL AND shared->>'access'='public'
   AND shared->>'state' IN ('current','updating') THEN
   BEGIN
    parsed:=previous::pg_snapshot;
   EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    valid:=false;
   END;
   IF valid THEN
    SELECT EXISTS(SELECT 1 FROM tracker_analytics_v1.access_revocations
     WHERE source_txid>=pg_snapshot_xmin(parsed)
      AND NOT pg_visible_in_snapshot(source_txid,parsed)) INTO changed;
   END IF;
  END IF;
  checks:=checks||jsonb_build_array(jsonb_build_object('snapshot',previous,'valid',valid,'accessChanged',changed));
 END LOOP;
 RETURN jsonb_build_object('version','public-hud-summary-batch-v1','summary',shared,'checks',checks);
END $$;
REVOKE ALL ON FUNCTION public.get_public_player_hud_summary_batch_v1(uuid,uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_player_hud_summary_batch_v1(uuid,uuid,text[]) TO anon,authenticated,service_role;
COMMIT;
