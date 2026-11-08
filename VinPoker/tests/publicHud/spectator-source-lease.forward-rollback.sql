-- Quiesce the spectator worker first. Exact candidate recovery only.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE spectator_projection_v2.work_groups IN ACCESS EXCLUSIVE MODE;
DO $recover$ DECLARE saved record; BEGIN
 IF EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups WHERE claimed_until>clock_timestamp())
 THEN RAISE EXCEPTION 'Spectator source recovery needs no active leases';END IF;
 SELECT * INTO STRICT saved FROM spectator_projection_v2.source_lease_original_v1;
 IF md5(replace(pg_get_functiondef(saved.signature::regprocedure),chr(13),'')) IS DISTINCT FROM saved.candidate_definition_hash
 OR md5(saved.definition) IS DISTINCT FROM saved.original_definition_hash
 THEN RAISE EXCEPTION 'Spectator source recovery preimage differs';END IF;
 EXECUTE saved.definition;
 IF md5(replace(pg_get_functiondef(saved.signature::regprocedure),chr(13),'')) IS DISTINCT FROM saved.original_definition_hash
 THEN RAISE EXCEPTION 'Spectator source recovery differs';END IF;
END $recover$;
COMMIT;
