-- CRITICAL: never wait on worker-owned projection rows in source transactions.
-- Only derived invalidation behavior changes; source money/chip writers stay intact.
-- Recovery is a reviewed forward restoration from the guarded original below.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF current_user<>'postgres'
 OR to_regclass('spectator_projection_v2.source_nonblocking_original_v1') IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure
  AND proowner='postgres'::regrole AND prosecdef AND provolatile='v'
  AND proconfig=ARRAY['search_path=""']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  AND md5(replace(prosrc,chr(13),''))='76e70967db6247ba01fc6d1e9f8355e9')
 THEN RAISE EXCEPTION 'nonblocking_generation342_preimage_drift';END IF;
END $guard$;
CREATE TABLE spectator_projection_v2.source_nonblocking_original_v1(
 signature text PRIMARY KEY CHECK(signature='spectator_projection_v2.mark_dirty(uuid,text,text,text)'),
 definition text NOT NULL,original_body_md5 text NOT NULL,candidate_body_md5 text NOT NULL
);
ALTER TABLE spectator_projection_v2.source_nonblocking_original_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.source_nonblocking_original_v1 FROM PUBLIC,anon,authenticated,service_role;
DO $rewrite$
DECLARE target constant regprocedure:='spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure;
 original text:=replace(pg_get_functiondef(target),chr(13),'');changed text;
 metadata jsonb;needle text;replacement text;
BEGIN
 SELECT to_jsonb(p)-'prosrc' INTO metadata FROM pg_proc p WHERE p.oid=target;
 changed:=original;
 needle:='DECLARE generation bigint; already_marked boolean;';
 IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'generation342_declaration_anchor_drift';END IF;
 changed:=replace(changed,needle,needle||' projection_busy boolean:=false;');
 needle:=' IF NOT pg_try_advisory_xact_lock(hashtextextended(''public-gen:''||p_tournament_id::text,0)) THEN';
 replacement:=$new$ IF pg_try_advisory_xact_lock(hashtextextended('public-gen:'||p_tournament_id::text,0)) THEN
  BEGIN
   -- Match publisher order. NOWAIT covers both claim-held groups and
   -- publisher-held markers. On contention this subtransaction releases any
   -- earlier probe lock before using the existing deferred invalidation path.
   PERFORM 1 FROM spectator_projection_v2.work_groups
    WHERE tournament_id=p_tournament_id AND component=p_component AND group_key='component'
    FOR UPDATE NOWAIT;
   PERFORM 1 FROM spectator_projection_v2.entity_markers
    WHERE tournament_id=p_tournament_id AND component=p_component AND entity_key='generation'
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN projection_busy:=true;
  END;
 ELSE projection_busy:=true;
 END IF;
 IF projection_busy THEN$new$;
 IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'generation342_advisory_anchor_drift';END IF;
 changed:=replace(changed,needle,replacement);
 EXECUTE changed;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata
 THEN RAISE EXCEPTION 'generation342_function_metadata_changed';END IF;
 INSERT INTO spectator_projection_v2.source_nonblocking_original_v1
 SELECT target::text,original,'76e70967db6247ba01fc6d1e9f8355e9',md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target;
END $rewrite$;
COMMIT;
