-- Controlled recovery template, before visibility-work reversal. Keep data.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE tracker_analytics_v1.config,tracker_analytics_v1.jobs IN ACCESS EXCLUSIVE MODE;
DO $restore$ DECLARE r record;BEGIN
 IF EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE enabled OR worker_enabled)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE lease_token IS NOT NULL)
 THEN RAISE EXCEPTION 'HUD wake recovery needs disabled reads/worker and no leases';END IF;
 SELECT * INTO STRICT r FROM tracker_analytics_v1.visibility_wake_original_v1;
 IF md5(replace(pg_get_functiondef(r.signature::regprocedure),chr(13),''))<>r.candidate_definition_hash
 OR md5(r.definition)<>r.original_definition_hash
 THEN RAISE EXCEPTION 'HUD wake recovery drift';END IF;
 EXECUTE r.definition;
 IF md5(replace(pg_get_functiondef(r.signature::regprocedure),chr(13),''))<>r.original_definition_hash
 THEN RAISE EXCEPTION 'HUD wake recovery differs';END IF;
END $restore$;
COMMIT;
