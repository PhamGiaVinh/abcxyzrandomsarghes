-- A successful required-child publication may wake its unleased current parent.
-- Do not wait for parent locks while holding a child job: metadata enqueues in
-- parent→child order. SKIP LOCKED retains the existing retry when parent is busy.
-- No source/counter/barrier/fence/lease changes. Recovery template accompanies
-- this migration; production recovery requires exact reviewed approval.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE tracker_analytics_v1.config,tracker_analytics_v1.jobs IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE enabled OR worker_enabled)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE lease_token IS NOT NULL)
 THEN RAISE EXCEPTION 'HUD visibility wake needs disabled reads/worker and no leases';END IF;
 IF md5(replace(pg_get_functiondef('public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'::regprocedure),chr(13),''))
  IS DISTINCT FROM '88a66fee5368a32e79a663dcadcd99e3'
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'::regprocedure
  AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=""']::text[])
 THEN RAISE EXCEPTION 'HUD visibility wake preimage differs';END IF;
END $guard$;
CREATE TABLE tracker_analytics_v1.visibility_wake_original_v1 (
 signature text PRIMARY KEY CHECK(signature='public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'),
 definition text NOT NULL,
 original_definition_hash text NOT NULL,
 candidate_definition_hash text NOT NULL
);
ALTER TABLE tracker_analytics_v1.visibility_wake_original_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tracker_analytics_v1.visibility_wake_original_v1 FROM PUBLIC,anon,authenticated,service_role;
DO $wake$ DECLARE body text;before_metadata jsonb;
 signature constant text:='public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)';
 target constant text:='  DELETE FROM tracker_analytics_v1.visibility_work WHERE hand_id=p_entity;';
 replacement constant text:='  WITH retired AS (
    DELETE FROM tracker_analytics_v1.visibility_work WHERE hand_id=p_entity
    RETURNING tournament_id,generation
  ), eligible AS MATERIALIZED (
    SELECT j.kind,j.entity_id FROM tracker_analytics_v1.jobs j
    WHERE j.kind=''visibility'' AND j.lease_token IS NULL AND EXISTS(
      SELECT 1 FROM retired r WHERE r.tournament_id=j.entity_id AND r.generation=j.generation)
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE tracker_analytics_v1.jobs j SET available_at=least(j.available_at,clock_timestamp())
    FROM eligible e WHERE j.kind=e.kind AND j.entity_id=e.entity_id;';
BEGIN
 body:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 IF (length(body)-length(replace(body,target,'')))/length(target)<>1
 THEN RAISE EXCEPTION 'HUD visibility wake rewrite differs';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_proc p WHERE p.oid=signature::regprocedure;
 EXECUTE replace(body,target,replacement);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=signature::regprocedure) IS DISTINCT FROM before_metadata
 THEN RAISE EXCEPTION 'HUD visibility wake metadata differs';END IF;
 INSERT INTO tracker_analytics_v1.visibility_wake_original_v1 VALUES(signature,body,md5(body),
  md5(replace(pg_get_functiondef(signature::regprocedure),chr(13),'')));
END $wake$;
COMMIT;
