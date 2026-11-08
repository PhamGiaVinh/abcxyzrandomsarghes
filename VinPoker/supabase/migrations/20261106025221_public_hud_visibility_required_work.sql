-- Wait only for work registered by this visibility generation. New ordinary
-- hands must not extend restoration indefinitely. Derived data only.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE tracker_analytics_v1.config,tracker_analytics_v1.jobs IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE enabled OR worker_enabled)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE lease_token IS NOT NULL) THEN
  RAISE EXCEPTION 'HUD required work needs disabled reads/worker and no outstanding leases';
 END IF;
 IF md5(replace(pg_get_functiondef('public.process_public_hud_metadata_v1(text,uuid,bigint,uuid)'::regprocedure),chr(13),''))
   IS DISTINCT FROM 'ac3c705ee94ca18024759124088a15e8'
 OR md5(replace(pg_get_functiondef('public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'::regprocedure),chr(13),''))
   IS DISTINCT FROM '9bb2728bff8e77d32d8c92e55bafe9a4' THEN
  RAISE EXCEPTION 'HUD required work preimage differs';
 END IF;
 IF to_regclass('tracker_analytics_v1.visibility_work') IS NOT NULL THEN
  RAISE EXCEPTION 'HUD required work catalog collision';
 END IF;
END $guard$;
CREATE TABLE tracker_analytics_v1.visibility_work (
 tournament_id uuid NOT NULL,
 generation bigint NOT NULL,
 hand_id uuid NOT NULL,
 kind text NOT NULL DEFAULT 'visibility' CHECK(kind='visibility'),
 PRIMARY KEY(tournament_id,generation,hand_id),
 FOREIGN KEY(kind,tournament_id) REFERENCES tracker_analytics_v1.jobs(kind,entity_id) ON DELETE CASCADE
);
CREATE INDEX visibility_work_hand_idx ON tracker_analytics_v1.visibility_work(hand_id);
ALTER TABLE tracker_analytics_v1.visibility_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tracker_analytics_v1.visibility_work FROM PUBLIC,anon,authenticated,service_role;
-- Preserve required work already enqueued by an earlier metadata page. Include
-- old contribution ownership for a hand moved/deleted since that page.
INSERT INTO tracker_analytics_v1.visibility_work(tournament_id,generation,hand_id)
SELECT DISTINCT v.entity_id,v.generation,j.entity_id
FROM tracker_analytics_v1.jobs v JOIN tracker_analytics_v1.jobs j ON j.kind='hand'
WHERE v.kind='visibility' AND v.refresh_hands AND (
 EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.id=j.entity_id AND h.tournament_id=v.entity_id)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.hand_contributions c WHERE c.hand_id=j.entity_id AND c.tournament_id=v.entity_id));
DO $rewrite$ DECLARE body text; target text; replacement text; BEGIN
 body:=replace(pg_get_functiondef('public.process_public_hud_metadata_v1(text,uuid,bigint,uuid)'::regprocedure),chr(13),'');
 target:='    desired:=EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_entity AND deleted_at IS NULL);';
 replacement:='    DELETE FROM tracker_analytics_v1.visibility_work WHERE tournament_id=p_entity AND generation<>p_generation;
'||target;
 IF (length(body)-length(replace(body,target,'')))/length(target)<>1 THEN RAISE EXCEPTION 'HUD required generation rewrite differs';END IF;
 body:=replace(body,target,replacement);
 target:='        PERFORM tracker_analytics_v1.enqueue(''hand'',target.id,true);';
 replacement:=target||'
        -- Enqueue deliberately skips a new in-progress hand without any old
        -- contribution/job. Such a no-op has no publication to wait for.
        INSERT INTO tracker_analytics_v1.visibility_work(tournament_id,generation,hand_id)
        SELECT p_entity,p_generation,target.id WHERE EXISTS(
          SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind=''hand'' AND entity_id=target.id)
        ON CONFLICT DO NOTHING;';
 IF (length(body)-length(replace(body,target,'')))/length(target)<>1 THEN RAISE EXCEPTION 'HUD required registration rewrite differs';END IF;
 body:=replace(body,target,replacement);
 target:='      IF queued=200 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs j
        JOIN public.tournament_hands h ON h.id=j.entity_id WHERE j.kind=''hand'' AND h.tournament_id=p_entity) THEN';
 replacement:='      IF queued=200 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.visibility_work
        WHERE tournament_id=p_entity AND generation=p_generation) THEN';
 IF (length(body)-length(replace(body,target,'')))/length(target)<>1 THEN RAISE EXCEPTION 'HUD required wait rewrite differs';END IF;
 EXECUTE replace(body,target,replacement);
 body:=replace(pg_get_functiondef('public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'::regprocedure),chr(13),'');
 target:='  DELETE FROM tracker_analytics_v1.jobs WHERE kind=''hand'' AND entity_id=p_entity;';
 replacement:='  -- Only the successful fenced replacement/subtraction reaches this point.
  -- Do not attach hand FK cascade: deleted source still needs subtraction.
  DELETE FROM tracker_analytics_v1.visibility_work WHERE hand_id=p_entity;
'||target;
 IF (length(body)-length(replace(body,target,'')))/length(target)<>1 THEN RAISE EXCEPTION 'HUD required completion rewrite differs';END IF;
 EXECUTE replace(body,target,replacement);
END $rewrite$;
COMMIT;
