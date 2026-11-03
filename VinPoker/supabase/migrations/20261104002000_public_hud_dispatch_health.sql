-- Definitions only. Vault provisioning, worker_enabled and cron scheduling are
-- separate actions in the exact owner-approved activation package.
BEGIN;
ALTER TABLE tracker_analytics_v1.config ADD COLUMN worker_enabled boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.dispatch_public_hud_projection_v1() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target text; secret text; request_id bigint;
BEGIN
 IF NOT (SELECT worker_enabled FROM tracker_analytics_v1.config WHERE singleton) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE available_at<=clock_timestamp()
  AND (lease_until IS NULL OR lease_until<clock_timestamp())) THEN RETURN NULL; END IF;
 target:=nullif(current_setting('app.supabase_url',true),'');
 IF target IS NULL THEN RAISE LOG 'public HUD dispatcher skipped: target missing';RETURN NULL; END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='PUBLIC_HUD_WORKER_SECRET';
 IF secret IS NULL OR btrim(secret)='' THEN RAISE LOG 'public HUD dispatcher skipped: credential missing';RETURN NULL; END IF;
 SELECT net.http_post(url:=target||'/functions/v1/public-hud-projector-v1',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
  body:='{}'::jsonb,timeout_milliseconds:=8000) INTO request_id;
 RETURN request_id;
END $$;
CREATE FUNCTION public.get_public_hud_projection_health_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('version',(SELECT version FROM tracker_analytics_v1.config WHERE singleton),
  'readEnabled',(SELECT enabled FROM tracker_analytics_v1.config WHERE singleton),
  'workerEnabled',(SELECT worker_enabled FROM tracker_analytics_v1.config WHERE singleton),
  'backfillComplete',(SELECT backfill_complete FROM tracker_analytics_v1.config WHERE singleton),
  'jobs',(SELECT count(*) FROM tracker_analytics_v1.jobs),
  'oldestLiveChangeAt',(SELECT oldest_pending_at FROM tracker_analytics_v1.jobs WHERE priority=0 ORDER BY oldest_pending_at LIMIT 1),
  'oldestBackfillAt',(SELECT oldest_pending_at FROM tracker_analytics_v1.jobs WHERE priority=10 ORDER BY oldest_pending_at LIMIT 1),
  'expiredLeases',(SELECT count(*) FROM tracker_analytics_v1.jobs WHERE lease_until<clock_timestamp()),
  'failedJobs',(SELECT count(*) FROM tracker_analytics_v1.jobs WHERE error_code IS NOT NULL),
  'sourceDataBytes',pg_total_relation_size('public.tournament_hands')+pg_total_relation_size('public.hand_players')+pg_total_relation_size('public.hand_actions'),
  'projectionBytes',pg_total_relation_size('tracker_analytics_v1.hand_contributions')+pg_total_relation_size('tracker_analytics_v1.player_totals')+pg_total_relation_size('tracker_analytics_v1.tournament_totals'),
  'checkedAt',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.dispatch_public_hud_projection_v1(),public.get_public_hud_projection_health_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_public_hud_projection_v1(),public.get_public_hud_projection_health_v1() TO service_role;
COMMIT;
