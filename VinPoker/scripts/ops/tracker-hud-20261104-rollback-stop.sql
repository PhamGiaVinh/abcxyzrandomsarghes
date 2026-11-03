-- Owner-approved rollback phase 2, only after phase 1 Broadcast is observed.
-- Retain the matching spectator worker/RPC/cron; do not mix it with older code.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE enabled OR backfill_complete)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.revocation_broadcast_v1)
 THEN RAISE EXCEPTION 'read-disable/revocation flush prerequisite incomplete';END IF;
END $$;
UPDATE tracker_analytics_v1.config SET worker_enabled=false WHERE singleton;
DO $$ DECLARE target bigint;BEGIN
 SELECT jobid INTO STRICT target FROM cron.job WHERE jobname='public-hud-projection-v1-dispatch';
 PERFORM cron.alter_job(target,active:=false);
END $$;
ALTER TABLE public.tournament_hands DISABLE TRIGGER hud_hand_changed;
ALTER TABLE public.tournament_settlement_outcomes DISABLE TRIGGER hud_outcome_changed;
ALTER TABLE public.player_results DISABLE TRIGGER hud_result_changed;
ALTER TABLE public.tournaments DISABLE TRIGGER hud_visibility_changed;
ALTER TABLE tracker_analytics_v1.job_players DISABLE TRIGGER hud_withdrawal_broadcast;
COMMIT;
-- Re-enable only after a newly reviewed full reconciliation of source AND prior
-- contribution IDs (including deleted sources). Never trust the old checkpoint.
