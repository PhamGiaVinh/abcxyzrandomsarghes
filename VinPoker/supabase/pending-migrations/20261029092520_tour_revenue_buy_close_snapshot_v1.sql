-- Pending LOCAL candidate. Captures only future explicit buy-close transitions;
-- historical closed tours are never reconstructed or silently backfilled.
-- Rollback: remove trigger + new functions/table (archive snapshots first if retained).
BEGIN;
SET LOCAL lock_timeout='3s';
DO $copy$
DECLARE body text; position integer;
BEGIN
 IF to_regclass('floor_private.tour_revenue_buy_close_v1') IS NOT NULL
 OR to_regprocedure('floor_private.tour_revenue_live_source_v1(uuid)') IS NOT NULL
 OR to_regprocedure('public.get_tour_revenue_buy_close_v1(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'tour_revenue_snapshot_collision';
 END IF;
 SELECT prosrc INTO STRICT body FROM pg_proc
 WHERE oid='public.get_owner_tour_rake_live_v1(uuid)'::regprocedure
 AND md5(prosrc)='0789f3ee623845e4624d848f7693a263';
 position:=strpos(body,' WITH receipts AS (');
 IF position=0 THEN RAISE EXCEPTION 'tour_revenue_source_drift';END IF;
 -- Two consumers share exactly the same audited classification: live owner read
 -- and the internal close trigger. The internal reader is never executable by clients.
 EXECUTE 'CREATE FUNCTION floor_private.tour_revenue_live_source_v1(p_club_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='''''
 ||' AS $body$ DECLARE v_tours jsonb; BEGIN '||substr(body,position)||'$body$';
END $copy$;
REVOKE ALL ON FUNCTION floor_private.tour_revenue_live_source_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE floor_private.tour_revenue_buy_close_v1 (
 tournament_id uuid PRIMARY KEY REFERENCES public.tournaments(id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 registration_closed_at timestamptz NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 captured_by uuid,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object')
);
ALTER TABLE floor_private.tour_revenue_buy_close_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tour_revenue_buy_close_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.keep_tour_revenue_snapshot_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'tour_revenue_snapshot_immutable' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION floor_private.keep_tour_revenue_snapshot_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tour_revenue_snapshot_immutable_v1 BEFORE UPDATE OR DELETE
 ON floor_private.tour_revenue_buy_close_v1 FOR EACH ROW
 EXECUTE FUNCTION floor_private.keep_tour_revenue_snapshot_immutable_v1();
CREATE FUNCTION floor_private.capture_tour_revenue_buy_close_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb;
BEGIN
 -- Tournament row lock already serializes the canonical registration guard.
 SELECT e INTO STRICT payload FROM jsonb_array_elements(
  floor_private.tour_revenue_live_source_v1(NEW.club_id)->'tours') e
 WHERE e->>'tournamentId'=NEW.id::text;
 INSERT INTO floor_private.tour_revenue_buy_close_v1
  (tournament_id,club_id,registration_closed_at,captured_by,snapshot)
 VALUES(NEW.id,NEW.club_id,NEW.registration_closed_at,auth.uid(),
  payload||jsonb_build_object('provisional',false));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.capture_tour_revenue_buy_close_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_tour_revenue_buy_close_v1
 AFTER UPDATE OF registration_closed_at ON public.tournaments FOR EACH ROW
 WHEN (OLD.registration_closed_at IS NULL AND NEW.registration_closed_at IS NOT NULL)
 EXECUTE FUNCTION floor_private.capture_tour_revenue_buy_close_v1();
CREATE FUNCTION public.get_tour_revenue_buy_close_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE club uuid; closed_at timestamptz; saved floor_private.tour_revenue_buy_close_v1%ROWTYPE;
BEGIN
 SELECT t.club_id,t.registration_closed_at INTO club,closed_at FROM public.tournaments t WHERE t.id=p_tournament_id;
 -- Reuse the finance scope boundary before reading any financial snapshot.
 PERFORM public.get_owner_tour_rake_live_v1(club);
 IF closed_at IS NULL THEN RETURN jsonb_build_object('status','buy_open','canExport',false); END IF;
 SELECT * INTO saved FROM floor_private.tour_revenue_buy_close_v1 WHERE tournament_id=p_tournament_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','snapshot_missing','canExport',false); END IF;
 IF saved.club_id IS DISTINCT FROM club OR saved.registration_closed_at IS DISTINCT FROM closed_at THEN
  RETURN jsonb_build_object('status','closure_changed','canExport',false);
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN (saved.snapshot->>'unavailableBuys')::bigint=0
  AND saved.snapshot->>'eventDay' IS NOT NULL THEN 'final' ELSE 'unavailable' END,
  'canExport',(saved.snapshot->>'unavailableBuys')::bigint=0 AND saved.snapshot->>'eventDay' IS NOT NULL,
  'capturedAt',saved.captured_at,'registrationClosedAt',saved.registration_closed_at,'snapshot',saved.snapshot);
END $$;
REVOKE ALL ON FUNCTION public.get_tour_revenue_buy_close_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tour_revenue_buy_close_v1(uuid) TO authenticated;
COMMIT;
