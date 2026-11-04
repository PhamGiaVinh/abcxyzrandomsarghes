BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

-- Derived public JSON only. No source, money, chip or settlement writes.
CREATE TABLE spectator_projection_v2.current_table_publications_v1(
 tournament_id uuid NOT NULL,table_id uuid NOT NULL,generation bigint NOT NULL,
 payload jsonb NOT NULL,published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tournament_id,table_id)
);
CREATE TABLE spectator_projection_v2.current_table_read_originals_v1(
 signature text PRIMARY KEY,definition text NOT NULL,
 original_definition_hash text NOT NULL,prepared_definition_hash text NOT NULL
);
CREATE INDEX idx_public_current_table_expiry_v1 ON spectator_projection_v2.current_table_publications_v1(published_at,tournament_id,table_id);
ALTER TABLE spectator_projection_v2.current_table_publications_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE spectator_projection_v2.current_table_read_originals_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.current_table_publications_v1,spectator_projection_v2.current_table_read_originals_v1 FROM PUBLIC,anon,authenticated,service_role;

DO $prepare$
DECLARE fn record; changed text; prefix text; fill text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'prepared_table_apply_owner_required'; END IF;
 SELECT p.*,pg_get_function_arguments(p.oid) arguments,
  replace(pg_get_functiondef(p.oid),chr(13),'') definition INTO STRICT fn
 FROM pg_proc p WHERE p.oid='public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)'::regprocedure;
 IF md5(fn.definition)<>'db80387da18e4c3911de2531f8eb36e0' OR fn.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')
  OR fn.provolatile<>'s' OR NOT fn.prosecdef OR fn.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 THEN RAISE EXCEPTION 'prepared_table_reader_dependency_drift'; END IF;

 -- The publisher must always derive through the original expression. Calling
 -- the new public fastpath here could certify an older prepared row as fresh.
 EXECUTE format('CREATE FUNCTION spectator_projection_v2.current_table_source_v1(%s) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='''' AS %L',fn.arguments,fn.prosrc);
 REVOKE ALL ON FUNCTION spectator_projection_v2.current_table_source_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

 prefix:=$prefix$DECLARE cached jsonb; BEGIN
 SELECT c.payload INTO cached
 FROM spectator_projection_v2.current_table_publications_v1 c
 JOIN public.tournaments t ON t.id=c.tournament_id AND t.deleted_at IS NULL
 JOIN public.tournament_tables tt ON tt.id=c.table_id AND tt.tournament_id=t.id
 JOIN public.table_sessions ts ON ts.id=tt.table_session_id AND ts.closed_at IS NULL
 JOIN spectator_projection_v2.entity_markers m ON m.tournament_id=t.id
  AND m.component='tables' AND m.entity_key='generation' AND m.source_revision=c.generation
 WHERE c.tournament_id=p_tournament_id AND c.table_id=p_tournament_table_id
  AND c.payload->>'access'='public' AND c.payload->>'tableId'=tt.id::text
  AND c.payload->>'tableSessionId'=tt.table_session_id::text
  AND c.payload->>'sourceGeneration'=c.generation::text
  AND c.payload->>'state' IN ('live','last_completed','waiting')
  AND NOT EXISTS(SELECT 1 FROM spectator_projection_v2.deferred_generations_v1 d
   WHERE d.tournament_id=t.id AND d.component='tables');
 IF FOUND THEN RETURN cached; END IF;
 RETURN ($prefix$;
 IF array_length(string_to_array(fn.prosrc,'BEGIN RETURN ('),1)<>2 THEN RAISE EXCEPTION 'prepared_table_reader_anchor_drift'; END IF;
 changed:=replace(fn.definition,fn.prosrc,replace(fn.prosrc,'BEGIN RETURN (',prefix));
 EXECUTE changed;
 INSERT INTO spectator_projection_v2.current_table_read_originals_v1 VALUES(
  'public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)',fn.definition,md5(fn.definition),
  md5(replace(pg_get_functiondef(fn.oid),chr(13),'')));

 SELECT p.*,replace(pg_get_functiondef(p.oid),chr(13),'') definition INTO STRICT fn
 FROM pg_proc p WHERE p.oid='public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb)'::regprocedure;
 IF md5(fn.definition)<>'79ad660ca72d307c606b94fc8a1e0660' OR fn.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')
  OR NOT fn.prosecdef THEN RAISE EXCEPTION 'prepared_table_publisher_dependency_drift'; END IF;
 fill:=$fill$  -- All existing lease, fencing, exact vector and deferred guards ran
  -- above. Certify with the already-checked source vector, never a later token.
  -- Concurrent source writers can append deferred invalidations; audience reads
  -- reject these rows immediately until a newer generation is prepared.
  IF p_component='tables' THEN
    DELETE FROM spectator_projection_v2.current_table_publications_v1 WHERE tournament_id=p_tournament_id;
    INSERT INTO spectator_projection_v2.current_table_publications_v1(tournament_id,table_id,generation,payload)
    SELECT p_tournament_id,tt.id,(p_source_vector->>'generation')::bigint,
      spectator_projection_v2.current_table_source_v1(p_tournament_id,tt.id)
    FROM public.tournament_tables tt
    JOIN public.tournaments t ON t.id=tt.tournament_id AND t.deleted_at IS NULL
    JOIN public.table_sessions ts ON ts.id=tt.table_session_id AND ts.closed_at IS NULL
    WHERE tt.tournament_id=p_tournament_id;
    -- Retire old derived rows, including hard-deleted parents, without a
    -- cascading FK or any lock on business rows. No publication means no new
    -- cache growth; subsequent fills prune at most100 expired rows each.
    DELETE FROM spectator_projection_v2.current_table_publications_v1 c USING (
      SELECT old.tournament_id,old.table_id FROM spectator_projection_v2.current_table_publications_v1 old
      WHERE old.published_at<statement_timestamp()-interval '1 hour'
      ORDER BY old.published_at,old.tournament_id,old.table_id LIMIT 100 FOR UPDATE SKIP LOCKED
    ) expired WHERE c.tournament_id=expired.tournament_id AND c.table_id=expired.table_id;
  ELSIF p_component='visibility' AND NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL) THEN
    DELETE FROM spectator_projection_v2.current_table_publications_v1 WHERE tournament_id=p_tournament_id;
  END IF;
$fill$;
 IF array_length(string_to_array(fn.prosrc,'  -- The payload is a full component snapshot.'),1)<>2 THEN RAISE EXCEPTION 'prepared_table_publish_anchor_drift'; END IF;
 changed:=replace(fn.definition,'  -- The payload is a full component snapshot.',fill||'  -- The payload is a full component snapshot.');
 EXECUTE changed;
 INSERT INTO spectator_projection_v2.current_table_read_originals_v1 VALUES(
  'public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb)',fn.definition,md5(fn.definition),
  md5(replace(pg_get_functiondef(fn.oid),chr(13),'')));
END $prepare$;
COMMIT;
