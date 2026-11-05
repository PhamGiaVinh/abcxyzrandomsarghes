-- Stop the HUD dispatcher and restore the previously verified worker first.
-- This reverse removes only the additive batched RPC, retaining source/audit,
-- canonical claim/getter/publisher and every queued job/contribution.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ DECLARE scheduled boolean:=false; BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname=''public-hud-projection-v1-dispatch'' AND active)' INTO scheduled;
 END IF;
 IF scheduled OR coalesce((SELECT worker_enabled FROM tracker_analytics_v1.config WHERE singleton),true)
 THEN RAISE EXCEPTION 'HUD batch reverse requires stopped dispatcher'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.claim_public_hud_jobs_with_source_v1(integer)')
  AND md5(replace(pg_get_functiondef(oid),chr(13),''))='7d94b5d916cd03a5941f5df724abff07'
  AND proowner='postgres'::regrole AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=""']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}')
 THEN RAISE EXCEPTION 'HUD batch reverse definition or ACL drift'; END IF;
END $$;
DROP FUNCTION public.claim_public_hud_jobs_with_source_v1(integer);
COMMIT;
