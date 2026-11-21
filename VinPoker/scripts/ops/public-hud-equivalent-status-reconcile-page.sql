-- Owner-gated recovery after restoring the original HUD functions.
-- Run through psql with -X -v ON_ERROR_STOP=1 -v after_hand_id='' for
-- the first page. Persist next_after_hand_id only after COMMIT succeeds.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE singleton AND NOT enabled)
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
     WHERE oid='tracker_analytics_v1.hand_fingerprint(uuid)'::regprocedure)
       IS DISTINCT FROM '8fa662e5dbd073f9654183c90b2b5c5b'
 OR md5(replace(pg_get_functiondef('tracker_analytics_v1.visibility_changed()'::regprocedure),chr(13),''))
       IS DISTINCT FROM '1b3320cd0f08d14fde3f081c5b132246'
 THEN RAISE EXCEPTION 'HUD reconciliation requires original definitions and disabled reads'; END IF;
END $$;

WITH source_page AS (
 SELECT id AS hand_id FROM public.tournament_hands
 WHERE id >= coalesce(nullif(:'after_hand_id','')::uuid,'00000000-0000-0000-0000-000000000000')
   AND id IS DISTINCT FROM nullif(:'after_hand_id','')::uuid
 ORDER BY id LIMIT 200
), contribution_page AS (
 SELECT DISTINCT hand_id FROM tracker_analytics_v1.hand_contributions
 WHERE hand_id >= coalesce(nullif(:'after_hand_id','')::uuid,'00000000-0000-0000-0000-000000000000')
   AND hand_id IS DISTINCT FROM nullif(:'after_hand_id','')::uuid
 ORDER BY hand_id LIMIT 200
), page AS MATERIALIZED (
 SELECT hand_id FROM (SELECT hand_id FROM source_page UNION SELECT hand_id FROM contribution_page) ids
 ORDER BY hand_id LIMIT 200
), queued AS MATERIALIZED (
 SELECT hand_id,tracker_analytics_v1.enqueue('hand',hand_id,true) AS result FROM page
)
SELECT jsonb_build_object('scanned',count(*),'next_after_hand_id',max(hand_id::text),
 'done',count(*)<200) FROM queued;
COMMIT;
