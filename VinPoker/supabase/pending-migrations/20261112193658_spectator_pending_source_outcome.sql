-- Pending candidate only. Quiesce workers and verify recovery before release.
-- A durable deferred generation fences source publication just like a revoked lease.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
LOCK TABLE spectator_projection_v2.work_groups IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF current_user<>'postgres'
 OR to_regclass('spectator_projection_v2.source_pending_original_v1') IS NOT NULL
 OR EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups WHERE claimed_until>clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure
  AND proowner='postgres'::regrole AND prosecdef AND provolatile='s'
  AND proconfig=ARRAY['search_path=""']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  AND md5(replace(pg_get_functiondef(oid),chr(13),''))='0557076e4866159dc1095c5257ceb7c6')
 THEN RAISE EXCEPTION 'source_pending_outcome_preimage_or_lease_drift';END IF;
END $guard$;
CREATE TABLE spectator_projection_v2.source_pending_original_v1(
 signature text PRIMARY KEY CHECK(signature='public.get_public_spectator_projection_source_v2(uuid,text,uuid)'),
 definition text NOT NULL,original_definition_hash text NOT NULL,candidate_definition_hash text NOT NULL
);
ALTER TABLE spectator_projection_v2.source_pending_original_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.source_pending_original_v1 FROM PUBLIC,anon,authenticated,service_role;
DO $rewrite$
DECLARE target constant regprocedure:='public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure;
 original text:=replace(pg_get_functiondef(target),chr(13),'');changed text;metadata jsonb;
 needle constant text:='THEN RAISE EXCEPTION ''source_pending''; END IF;';
BEGIN
 IF (length(original)-length(replace(original,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'source_pending_outcome_anchor_drift';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO metadata FROM pg_proc p WHERE oid=target;
 changed:=replace(original,needle,'THEN RETURN jsonb_build_object(''fenced'',true); END IF;');
 EXECUTE changed;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata
 THEN RAISE EXCEPTION 'source_pending_outcome_metadata_drift';END IF;
 INSERT INTO spectator_projection_v2.source_pending_original_v1 VALUES(target::text,original,md5(original),md5(changed));
END $rewrite$;
COMMIT;
