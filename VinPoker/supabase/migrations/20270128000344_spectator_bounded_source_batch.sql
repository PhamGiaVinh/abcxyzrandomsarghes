-- Experimental pending candidate: isolated tests only until runtime qualification.
-- Reads only; canonical per-job source and publication fences remain authoritative.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.get_public_spectator_projection_sources_v2(jsonb)') IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure
  AND proowner='postgres'::regrole AND prosecdef AND provolatile='s'
  AND proconfig=ARRAY['search_path=""']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  AND md5(replace(pg_get_functiondef(oid),chr(13),''))='6269d9fc1b2737f30b56a4bcdb42fb79')
 THEN RAISE EXCEPTION 'spectator_source_batch_preimage_drift';END IF;
END $guard$;
CREATE FUNCTION public.get_public_spectator_projection_sources_v2(p_jobs jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $source_batch$
DECLARE item jsonb;source jsonb;receipt jsonb;reply jsonb:='[]'::jsonb;seen text[]:=ARRAY[]::text[];identity text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_jobs) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_source_batch' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_jobs) NOT BETWEEN 1 AND 6 OR octet_length(p_jobs::text)>8192
 THEN RAISE EXCEPTION 'invalid_source_batch' USING ERRCODE='22023';END IF;
 -- Validate the entire envelope before reading a source. No partial acceptance
 -- of a malformed/duplicate batch and no caller-provided SQL or public payload.
 FOR item IN SELECT value FROM jsonb_array_elements(p_jobs) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object'
   OR NOT item ?& ARRAY['tournament_id','component','fencing_token']
   OR item-ARRAY['tournament_id','component','fencing_token']<>'{}'::jsonb
   OR jsonb_typeof(item->'tournament_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'component') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'fencing_token') IS DISTINCT FROM 'string'
   OR item->>'component' NOT IN ('tables','ranking','payout','visibility')
   OR item->>'tournament_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR item->>'fencing_token' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'invalid_source_batch' USING ERRCODE='22023';END IF;
  identity:=(item->>'tournament_id')::uuid::text||':'||(item->>'component');
  IF identity=ANY(seen) THEN RAISE EXCEPTION 'duplicate_source_batch_job' USING ERRCODE='22023';END IF;
  seen:=array_append(seen,identity);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_jobs) LOOP
  BEGIN
   source:=public.get_public_spectator_projection_source_v2((item->>'tournament_id')::uuid,item->>'component',(item->>'fencing_token')::uuid);
   receipt:=item||jsonb_build_object('source',source);
   -- Bound transport, not source construction memory. Preserve large-source
   -- support through the unchanged single getter; never truncate source data.
   -- Reserve8KiB for all remaining bounded identity/error receipts.
   IF octet_length(convert_to((reply||jsonb_build_array(receipt))::text,'UTF8'))>1040384
   THEN receipt:=item||jsonb_build_object('requiresIndividual',true);END IF;
   reply:=reply||jsonb_build_array(receipt);
  EXCEPTION WHEN OTHERS THEN
   -- SQLERRM/context may include private data. This is an error receipt, never
   -- the canonical exact {fenced:true} no-op. Worker must fail this job normally.
   reply:=reply||jsonb_build_array(item||jsonb_build_object('error','source_failed','sqlstate',SQLSTATE));
  END;
 END LOOP;
 IF octet_length(convert_to(reply::text,'UTF8'))>1048576
 THEN RAISE EXCEPTION 'source_batch_response_budget' USING ERRCODE='54000';END IF;
 RETURN reply;
END $source_batch$;
REVOKE ALL ON FUNCTION public.get_public_spectator_projection_sources_v2(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_spectator_projection_sources_v2(jsonb) TO service_role;
COMMIT;
