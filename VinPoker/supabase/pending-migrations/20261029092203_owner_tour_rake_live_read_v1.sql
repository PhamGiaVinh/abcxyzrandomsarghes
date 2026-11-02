-- Pending LOCAL qualification only. Live receipts are provisional; this RPC
-- does not finalize revenue or authorize official export.
-- Rollback: DROP FUNCTION public.get_owner_tour_rake_live_v1(uuid);
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF to_regprocedure('public.get_owner_tour_rake_live_v1(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'owner_tour_rake_live_function_collision';
 END IF;
END $$;
CREATE FUNCTION public.get_owner_tour_rake_live_v1(p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_tours jsonb;
BEGIN
 IF v_actor IS NULL OR p_club_id IS NULL OR NOT (
  EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=p_club_id AND c.owner_id=v_actor)
  OR EXISTS(SELECT 1 FROM public.club_accountants a WHERE a.club_id=p_club_id AND a.user_id=v_actor)
  OR EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=v_actor AND u.role='super_admin')
 ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 WITH receipts AS (
  SELECT r.*, f.paid_refunds,f.refund_amount,
   CASE WHEN jsonb_typeof(r.price_snapshot)='object' AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['buy_in','rake','service_fee','platform_fee','total_pay']) k
    WHERE jsonb_typeof(r.price_snapshot->k) IS DISTINCT FROM 'number'
   ) THEN r.price_snapshot ELSE NULL END AS price
  FROM public.tournament_registrations r
  JOIN public.tournaments t ON t.id=r.tournament_id AND t.club_id=p_club_id
  LEFT JOIN LATERAL (
   SELECT count(*) AS paid_refunds,coalesce(sum(amount),0) AS refund_amount
   FROM public.cashier_refund_requests f WHERE f.registration_id=r.id AND f.status='paid'
  ) f ON true
  WHERE r.cashier_paid_at IS NOT NULL OR r.status='confirmed'
 ), amounts AS (
  SELECT r.*,(price->>'buy_in')::numeric AS snap_buy,
   (price->>'rake')::numeric AS snap_rake,(price->>'service_fee')::numeric AS snap_service,
   (price->>'platform_fee')::numeric AS snap_platform,(price->>'total_pay')::numeric AS snap_total
  FROM receipts r
 ), classified AS (
  SELECT r.*,
   (club_id=p_club_id AND status IN ('pending','confirmed') AND paid_refunds=0
    AND ((price IS NOT NULL AND snap_buy=buy_in AND snap_total=total_pay
      AND snap_buy>=0 AND snap_rake>=0 AND snap_service>=0 AND snap_platform>=0
      AND snap_buy=trunc(snap_buy) AND snap_rake=trunc(snap_rake)
      AND snap_service=trunc(snap_service) AND snap_platform=trunc(snap_platform)
      AND snap_buy+snap_rake+snap_service+snap_platform=snap_total)
     OR (price_snapshot IS NULL AND total_pay=buy_in AND buy_in>=0
      AND coalesce(platform_fixed_fee,0)=0))) IS TRUE AS valid,
   (club_id=p_club_id AND status='cancelled' AND paid_refunds=1 AND refund_amount=total_pay) IS TRUE AS refunded
  FROM amounts r
 ), totals AS (
  SELECT tournament_id,count(*) FILTER(WHERE NOT refunded) AS paid_buys,
   count(*) FILTER(WHERE valid AND status='pending') AS waiting_seat_buys,
   count(DISTINCT player_id) FILTER(WHERE valid) AS unique_players,
   count(*) FILTER(WHERE NOT valid AND NOT refunded) AS unavailable_buys,
   count(*) FILTER(WHERE refunded) AS refunded_buys,
   coalesce(sum(coalesce(snap_rake,0)) FILTER(WHERE valid),0) AS rake,
   coalesce(sum(coalesce(snap_service,0)) FILTER(WHERE valid),0) AS service,
   coalesce(sum(coalesce(snap_platform,0)) FILTER(WHERE valid),0) AS platform_fee,
   coalesce(sum(total_pay) FILTER(WHERE valid),0) AS collected
  FROM classified GROUP BY tournament_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'tournamentId',t.id,'name',t.name,'eventDay',
    (t.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  'registrationClosedAt',t.registration_closed_at,'provisional',true,
  'paidBuys',coalesce(a.paid_buys,0),'waitingSeatBuys',coalesce(a.waiting_seat_buys,0),
  'uniquePlayers',coalesce(a.unique_players,0),'refundedBuys',coalesce(a.refunded_buys,0),
  'unavailableBuys',coalesce(a.unavailable_buys,0),
  'rake',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.rake,0) END,
  'serviceFee',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.service,0) END,
  'platformFee',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.platform_fee,0) END,
  'collected',CASE WHEN coalesce(a.unavailable_buys,0)=0 THEN coalesce(a.collected,0) END
 ) ORDER BY t.start_time DESC NULLS LAST,t.id),'[]'::jsonb) INTO v_tours
 FROM public.tournaments t LEFT JOIN totals a ON a.tournament_id=t.id
 WHERE t.club_id=p_club_id;
 RETURN jsonb_build_object('clubId',p_club_id,'asOf',statement_timestamp(),'tours',v_tours);
END $$;
REVOKE ALL ON FUNCTION public.get_owner_tour_rake_live_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_owner_tour_rake_live_v1(uuid) TO authenticated;
COMMIT;
