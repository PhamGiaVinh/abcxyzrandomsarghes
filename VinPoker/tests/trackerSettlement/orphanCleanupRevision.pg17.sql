\set ON_ERROR_STOP on
-- Actual retained-schema local fixture; never production. All changes rollback.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_card56_overlap_20261011'
  OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
  OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'cleanup_revision_isolated_fixture_required'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','81100000-0000-4000-8000-000000000001')::text,true);
-- A completed hand is never reclaimed by this stale-active-hand operation.
UPDATE public.tournament_hands SET status='completed',locked_at=now()-interval '2 hours',created_at=now()-interval '2 hours'
 WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE cleanup_completed_before AS SELECT to_jsonb(h) snapshot FROM public.tournament_hands h
 WHERE id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.cleanup_orphan_hands(interval '10 minutes');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT snapshot FROM cleanup_completed_before) IS DISTINCT FROM
  (SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'cleanup_modified_completed_hand'; END IF;
END $$;
UPDATE public.tournament_hands SET status='in_progress',locked_by_user_id='81100000-0000-4000-8000-000000000001'
 WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE cleanup_before AS SELECT id,source_revision FROM public.tournament_hands
 WHERE id='86000000-0000-4000-8000-000000000001';
DO $$ DECLARE result jsonb; BEGIN
 PERFORM set_config('role','authenticated',true);
 result:=public.cleanup_orphan_hands(interval '0 minutes');
 IF result->>'error' IS DISTINCT FROM 'invalid_cleanup_window' THEN RAISE EXCEPTION 'cleanup_invalid_window_accepted'; END IF;
 PERFORM set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000099',true);
 result:=public.cleanup_orphan_hands(interval '10 minutes');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'cleanup_outsider_accepted'; END IF;
 PERFORM set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
 PERFORM set_config('role','none',true);
 IF EXISTS(SELECT 1 FROM cleanup_before b JOIN public.tournament_hands h USING(id) WHERE h.source_revision<>b.source_revision OR h.status<>'in_progress') THEN
  RAISE EXCEPTION 'cleanup_denial_changed_hand'; END IF;
 PERFORM set_config('role','authenticated',true);
 result:=public.cleanup_orphan_hands(interval '10 minutes');
 IF result->>'status' IS DISTINCT FROM 'success' OR (result->>'voided_count')::int<1 THEN RAISE EXCEPTION 'cleanup_owner_failed: %',result; END IF;
 PERFORM set_config('role','none',true);
 IF NOT EXISTS(SELECT 1 FROM cleanup_before b JOIN public.tournament_hands h USING(id)
  WHERE h.is_voided AND h.status='voided' AND h.source_revision>b.source_revision AND h.locked_by_user_id IS NULL) THEN
  RAISE EXCEPTION 'cleanup_revision_not_invalidated'; END IF;
 IF EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q JOIN cleanup_before b ON b.id=q.hand_id WHERE q.status IN('pending','processing')) THEN
  RAISE EXCEPTION 'cleanup_old_queue_still_executable'; END IF;
END $$;
ROLLBACK;
\echo ORPHAN_CLEANUP_REVISION_ROLE_QUEUE_PASS
