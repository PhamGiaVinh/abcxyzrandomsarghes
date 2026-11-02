-- Pending LOCAL. Floor redraw close left the rest marker stale: picker selected
-- a resting dealer, DB correctly refused. Extend the existing close trigger.
-- No history backfill. Recovery: Auto OFF and restore retained prior definition;
-- preserve every committed assignment, attendance marker, receipt and payroll.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $guard$ BEGIN
 IF current_user<>'postgres' OR to_regclass('floor_private.closed_session_rest_pre_20261030') IS NOT NULL
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.reconcile_closed_session_attendance_v1()'::regprocedure) IS DISTINCT FROM '1acf34b514430871452c5375f78d8b5a'
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='floor_private.reconcile_closed_session_attendance_v1()'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.table_sessions'::regclass AND tgname='trg_reconcile_closed_session_attendance_v1' AND tgenabled='O' AND tgfoid='floor_private.reconcile_closed_session_attendance_v1()'::regprocedure)
 THEN RAISE EXCEPTION 'closed_session_rest_marker_dependency_drift_or_collision'; END IF;
END $guard$;
CREATE TABLE floor_private.closed_session_rest_pre_20261030(signature text PRIMARY KEY,definition text NOT NULL);
ALTER TABLE floor_private.closed_session_rest_pre_20261030 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.closed_session_rest_pre_20261030 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.closed_session_rest_pre_20261030 SELECT oid::regprocedure::text,pg_get_functiondef(oid) FROM pg_proc WHERE oid='floor_private.reconcile_closed_session_attendance_v1()'::regprocedure;
CREATE OR REPLACE FUNCTION floor_private.reconcile_closed_session_attendance_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attendance_row public.dealer_attendance%ROWTYPE; release_at timestamptz;
BEGIN
 IF OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.dealer_assignments a
   LEFT JOIN public.dealer_attendance dat ON dat.id=a.attendance_id
   LEFT JOIN public.dealers d ON d.id=dat.dealer_id
   WHERE a.table_session_id=NEW.id AND
     (a.club_id IS DISTINCT FROM NEW.club_id OR a.table_id IS DISTINCT FROM NEW.game_table_id
      OR dat.id IS NULL OR a.dealer_id IS DISTINCT FROM dat.dealer_id
      OR d.club_id IS DISTINCT FROM NEW.club_id OR a.released_at IS NULL)) THEN
   RAISE EXCEPTION 'closed_session_dealer_context_invalid';
 END IF;
 -- The caller already holds physical/session locks. Acquire attendance in UUID
 -- order, matching assignment writers' physical/session -> attendance order.
 FOR attendance_row IN SELECT dat.* FROM public.dealer_attendance dat
   WHERE EXISTS(SELECT 1 FROM public.dealer_assignments a
     WHERE a.table_session_id=NEW.id AND a.attendance_id=dat.id AND a.released_at IS NOT NULL)
   ORDER BY dat.id FOR UPDATE LOOP
   IF attendance_row.status='checked_in' AND attendance_row.check_out_time IS NULL
     AND attendance_row.current_state='assigned'
     AND attendance_row.pre_assigned_table_id IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.dealer_assignments a
       WHERE a.attendance_id=attendance_row.id AND a.released_at IS NULL
         AND a.status IN ('assigned','on_break','pre_assigned','reserved')) THEN
     -- Only this close event starts a new rest clock; never reset older rest.
     SELECT max(a.released_at) INTO release_at FROM public.dealer_assignments a
       WHERE a.table_session_id=NEW.id AND a.attendance_id=attendance_row.id
         AND a.status='completed' AND a.released_at=NEW.closed_at
         AND a.assigned_at<=a.released_at;
     IF release_at IS NULL THEN
       RAISE EXCEPTION 'closed_session_dealer_rest_release_unverified';
     END IF;
     UPDATE public.dealer_attendance SET current_state='available',
       last_released_at=GREATEST(last_released_at,release_at),
       pool_entered_at=GREATEST(pool_entered_at,release_at)
       WHERE id=attendance_row.id AND current_state='assigned';
   END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
DO $post$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='floor_private.reconcile_closed_session_attendance_v1()'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}') THEN RAISE EXCEPTION 'closed_session_rest_marker_metadata_changed'; END IF;END $post$;
COMMIT;
