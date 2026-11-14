-- Quiesce workers. Restore only this exact derived-source change.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
LOCK TABLE spectator_projection_v2.work_groups IN ACCESS EXCLUSIVE MODE;
DO $restore$ DECLARE saved record;metadata jsonb;BEGIN
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups WHERE claimed_until>clock_timestamp())
 THEN RAISE EXCEPTION 'source_pending_recovery_actor_or_active_lease';END IF;
 SELECT * INTO STRICT saved FROM spectator_projection_v2.source_pending_original_v1;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=saved.signature::regprocedure
  AND proowner='postgres'::regrole AND prosecdef AND provolatile='s'
  AND proconfig=ARRAY['search_path=""']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}')
 THEN RAISE EXCEPTION 'source_pending_recovery_metadata_drift';END IF;
 IF saved.original_definition_hash IS DISTINCT FROM '0557076e4866159dc1095c5257ceb7c6'
 OR md5(saved.definition) IS DISTINCT FROM saved.original_definition_hash
 OR md5(replace(pg_get_functiondef(saved.signature::regprocedure),chr(13),'')) IS DISTINCT FROM saved.candidate_definition_hash
 THEN RAISE EXCEPTION 'source_pending_recovery_drift';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO metadata FROM pg_proc p WHERE oid=saved.signature::regprocedure;
 EXECUTE saved.definition;
 IF md5(replace(pg_get_functiondef(saved.signature::regprocedure),chr(13),'')) IS DISTINCT FROM saved.original_definition_hash
 THEN RAISE EXCEPTION 'source_pending_recovery_differs';END IF;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=saved.signature::regprocedure) IS DISTINCT FROM metadata
 THEN RAISE EXCEPTION 'source_pending_recovery_metadata_changed';END IF;
END $restore$;
COMMIT;
