-- A superseded source lease is a fenced no-op, not an RPC exception.
-- Authorization and publication vector/token checks remain unchanged.
-- Recovery: tests/publicHud/spectator-source-lease.forward-rollback.sql.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE spectator_projection_v2.work_groups IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups WHERE claimed_until>clock_timestamp())
 THEN RAISE EXCEPTION 'Spectator source outcome needs quiesced worker and no active leases';END IF;
 IF md5(replace(pg_get_functiondef('public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure),chr(13),''))
  IS DISTINCT FROM 'e2f16d348b583a4071683e811383a96d'
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure
  AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']::text[])
 THEN RAISE EXCEPTION 'Spectator source outcome preimage differs';END IF;
END $guard$;
CREATE TABLE spectator_projection_v2.source_lease_original_v1 (
 signature text PRIMARY KEY CHECK(signature='public.get_public_spectator_projection_source_v2(uuid,text,uuid)'),
 definition text NOT NULL,original_definition_hash text NOT NULL,candidate_definition_hash text NOT NULL
);
ALTER TABLE spectator_projection_v2.source_lease_original_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.source_lease_original_v1 FROM PUBLIC,anon,authenticated,service_role;
DO $rewrite$ DECLARE body text;before_metadata jsonb;
 signature constant text:='public.get_public_spectator_projection_source_v2(uuid,text,uuid)';
 target constant text:='    RAISE EXCEPTION ''lease_expired'';';
BEGIN
 body:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 IF (length(body)-length(replace(body,target,'')))/length(target)<>1
 THEN RAISE EXCEPTION 'Spectator source outcome rewrite differs';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_proc p WHERE p.oid=signature::regprocedure;
 EXECUTE replace(body,target,'    RETURN jsonb_build_object(''fenced'',true);');
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=signature::regprocedure) IS DISTINCT FROM before_metadata
 THEN RAISE EXCEPTION 'Spectator source outcome metadata differs';END IF;
 INSERT INTO spectator_projection_v2.source_lease_original_v1 VALUES(signature,body,md5(body),
  md5(replace(pg_get_functiondef(signature::regprocedure),chr(13),'')));
END $rewrite$;
COMMIT;
