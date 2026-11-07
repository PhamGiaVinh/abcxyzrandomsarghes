-- One service RPC instead of claim + one source RPC per hand. Source is never
-- supplied by callers. Existing canonical publication fences remain mandatory.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.claim_public_hud_jobs_with_source_v1(integer)') IS NOT NULL
 OR md5(replace(pg_get_functiondef('public.claim_public_hud_jobs_v1(integer)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'e88396da0ba3dcdfbde883d2b5d3ca21'
 OR md5(replace(pg_get_functiondef('public.get_public_hud_job_source_v1(text,uuid,bigint,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'a0c9e5937e01adcfea5240c3757877f2'
 THEN RAISE EXCEPTION 'hud_claim_source_dependency_drift'; END IF;
END $$;

CREATE FUNCTION public.claim_public_hud_jobs_with_source_v1(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb; job jsonb; source jsonb; source_failed boolean; result jsonb:='[]'::jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 80 THEN
  RAISE EXCEPTION 'invalid_limit';
 END IF;
 -- The unchanged canonical claim validates limits, orders priorities and uses
 -- SKIP LOCKED with fresh fencing tokens and the existing 15-second lease.
 claims:=public.claim_public_hud_jobs_v1(p_limit);
 FOR job IN SELECT value FROM jsonb_array_elements(claims) LOOP
  source:=NULL; source_failed:=false;
  IF job->>'kind'='hand' THEN
   BEGIN
    -- A separate PL/pgSQL statement sees this transaction's own claims.
    -- The stable getter adds no source-row lock after the queue-row locks.
    source:=public.get_public_hud_job_source_v1(job->>'kind',(job->>'entity_id')::uuid,
      (job->>'generation')::bigint,(job->>'lease_token')::uuid);
   EXCEPTION WHEN OTHERS THEN
    -- Isolate malformed/unavailable source to this claim. Do not disclose SQL
    -- text and do not roll back the other claims. Existing fail RPC handles it.
    source:=NULL; source_failed:=true;
   END;
  END IF;
  result:=result||jsonb_build_array(job||jsonb_build_object('source',source,'source_error',source_failed));
 END LOOP;
 RETURN result;
END $$;
ALTER FUNCTION public.claim_public_hud_jobs_with_source_v1(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_public_hud_jobs_with_source_v1(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_public_hud_jobs_with_source_v1(integer) TO service_role;
COMMIT;
