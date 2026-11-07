-- Owner-approved rollback phase 1. Commit before waiting for Broadcast delivery.
-- Keeps the matching compact spectator pipeline running for access revocation.
BEGIN;
SET LOCAL lock_timeout='5s';
UPDATE tracker_analytics_v1.config SET enabled=false,backfill_complete=false WHERE singleton;
SELECT tracker_analytics_v1.queue_revocation_v1();
COMMIT;
