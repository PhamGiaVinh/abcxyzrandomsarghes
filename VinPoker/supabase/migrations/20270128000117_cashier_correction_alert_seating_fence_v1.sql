-- CLI candidate20261016100936, catalog117. LOCAL ONLY, NOT RELEASED.
-- Align paid/re-entry allocation with the existing Floor mode correction
-- blocker: alerts are canonical even when no Voice config exists.
-- Recovery: reviewed forward restoration with paid seating disabled; preserve
-- alerts, money, entries, tickets and audit. Never resolve an alert to seat.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE target regprocedure:='floor_private.pick_cashier_canonical_seat_v1(uuid,text)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 needle text:='   SELECT n INTO free_seat FROM generate_series(1,tt.max_seats) n';
BEGIN
 IF current_user<>'postgres' OR md5(definition)<>'770a70ad4ae2226a2fdc82adf1e1f9ae'
 OR to_regclass('public.tracker_floor_alerts') IS NULL THEN RAISE EXCEPTION 'cashier117_catalog_or_dependency_drift';END IF;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'cashier117_alert_anchor_drift';END IF;
 EXECUTE replace(definition,needle,$new$   IF EXISTS(SELECT 1 FROM public.tracker_floor_alerts a JOIN public.tournament_hands h ON h.id=a.hand_id
    WHERE h.tournament_id=tour.id AND a.correction_required IS TRUE AND a.status IN ('open','acknowledged','in_progress')
     AND (h.table_session_id=sess.id OR (h.table_session_id IS NULL AND h.tournament_table_id=tt.id))) THEN CONTINUE;END IF;
$new$||needle);
END;
$patch$;
COMMIT;
