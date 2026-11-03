-- Pending LOCAL candidate. Explicit buy closure only; no payout, result,
-- payroll, notification or table/dealer state changes.
-- Rollback: DROP FUNCTION public.close_tournament_buy_v1(uuid);
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.close_tournament_buy_v1(uuid)') IS NOT NULL
 OR to_regclass('floor_private.tour_revenue_buy_close_v1') IS NULL THEN
  RAISE EXCEPTION 'buy_close_collision_or_missing_snapshot_dependency';
 END IF;
END $$;
CREATE FUNCTION public.close_tournament_buy_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); tour public.tournaments%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR NOT (public.is_club_owner(actor,tour.club_id)
  OR public.is_club_admin(actor,tour.club_id)
  OR public.is_club_cashier(actor,tour.club_id)
  OR public.is_club_floor(actor,tour.club_id)) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF tour.registration_closed_at IS NOT NULL THEN
  RETURN jsonb_build_object('status','already_closed','registrationClosedAt',tour.registration_closed_at);
 END IF;
 IF tour.status IN ('completed','cancelled') OR tour.live_status='finished' THEN
  RAISE EXCEPTION 'buy_close_terminal_tournament' USING ERRCODE='55000'; END IF;
 -- Paid pending registrations cannot be seated through the current confirmation
 -- RPC after closure; finish that workflow first rather than strand paid buys.
 IF EXISTS(SELECT 1 FROM public.tournament_registrations r
  WHERE r.tournament_id=tour.id AND r.status='pending' AND r.cashier_paid_at IS NOT NULL) THEN
  RAISE EXCEPTION 'buy_close_paid_registration_waiting_seat' USING ERRCODE='55000'; END IF;
 UPDATE public.tournaments SET registration_closed_at=clock_timestamp()
 WHERE id=tour.id RETURNING registration_closed_at INTO tour.registration_closed_at;
 RETURN jsonb_build_object('status','closed','registrationClosedAt',tour.registration_closed_at);
END $$;
REVOKE ALL ON FUNCTION public.close_tournament_buy_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.close_tournament_buy_v1(uuid) TO authenticated;
COMMIT;
