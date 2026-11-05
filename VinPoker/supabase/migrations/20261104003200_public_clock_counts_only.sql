-- Project only the three canonical entry counters consumed by the public clock.
-- No source writes, result cache, new caller authority or clock-rule changes.
-- Recovery: tests/publicHud/clock-counts.forward-rollback.sql, before025/023/022.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE spectator_projection_v2.clock_counts_original_v1 (
 signature text PRIMARY KEY CHECK(signature='public.get_public_tournament_clock_summary(uuid)'),
 definition text NOT NULL,
 original_definition_hash text NOT NULL,
 candidate_definition_hash text NOT NULL
);
ALTER TABLE spectator_projection_v2.clock_counts_original_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.clock_counts_original_v1 FROM PUBLIC,anon,authenticated,service_role;

DO $clock_counts$
DECLARE target_signature constant text:='public.get_public_tournament_clock_summary(uuid)';
 expected_hash constant text:='6eb40dbf8d7444e09924a68ffd921d1b';
 body text; rewritten text; before_metadata jsonb;
 needle constant text:='floor_private.tournament_participation_v1(t.id)->''counts'' counts';
 replacement constant text:='(SELECT jsonb_build_object(
      ''remaining'',count(DISTINCT (e.player_id,e.entry_no)) FILTER(WHERE e.status IN (''registered'',''seated'')),
      ''total_entries'',count(DISTINCT (e.player_id,e.entry_no)) FILTER(WHERE e.status<>''cancelled''),
      ''live_entry_stack'',coalesce(sum(e.current_stack) FILTER(WHERE e.status IN (''registered'',''seated'')),0))
    FROM public.tournament_entries e WHERE e.tournament_id=t.id) counts';
BEGIN
 body:=replace(pg_get_functiondef(target_signature::regprocedure),chr(13),'');
 IF md5(body)<>expected_hash
 OR md5(replace(pg_get_functiondef('floor_private.tournament_participation_v1(uuid)'::regprocedure),chr(13),''))<>'756297c6ef11962b0e53b4dcfc38a24d'
 OR EXISTS(SELECT 1 FROM pg_proc WHERE oid IN (target_signature::regprocedure,'floor_private.tournament_participation_v1(uuid)'::regprocedure)
   AND proowner<>'postgres'::regrole)
 OR (SELECT proacl::text FROM pg_proc WHERE oid=target_signature::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'
 OR (SELECT proacl::text FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}'
 OR NOT EXISTS(SELECT 1 FROM spectator_projection_v2.clock_read_plan_original_v1 r
   WHERE r.signature=target_signature AND r.wrapped_definition_hash=expected_hash)
 THEN RAISE EXCEPTION 'clock_counts_preimage_differs';END IF;
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'clock_counts_rewrite_differs';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_proc p WHERE p.oid=target_signature::regprocedure;
 -- These counters depend only on entry identity/status/current_stack in the
 -- pinned canonical helper. Seat classification and identity JSON do not alter
 -- them. Preserve DISTINCT generation counts and the original raw-row stack sum,
 -- including anomalous entries; do not silently repair business data here.
 rewritten:=replace(body,needle,replacement);
 EXECUTE rewritten;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target_signature::regprocedure) IS DISTINCT FROM before_metadata
 THEN RAISE EXCEPTION 'clock_counts_metadata_changed';END IF;
 INSERT INTO spectator_projection_v2.clock_counts_original_v1 VALUES(target_signature,body,expected_hash,
   md5(replace(pg_get_functiondef(target_signature::regprocedure),chr(13),'')));
END $clock_counts$;
COMMIT;
