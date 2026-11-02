-- CLI candidate20261016092947, catalog115. LOCAL ONLY, NOT RELEASED.
-- Same server-priced registration pattern as initial app registration; full
-- re-entry cost, no free-rake consumption. Existing unpriced rows fail closed.
-- Recovery: disable new Edge consumer then revoke/drop this additive endpoint;
-- keep registrations, payments and history intact.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' OR to_regprocedure('public.cashier_create_app_reentry_v1(uuid,uuid)') IS NOT NULL
 OR to_regprocedure('floor_private.pick_cashier_canonical_seat_v1(uuid,text)') IS NULL
 OR md5(replace(pg_get_functiondef('floor_private.pick_cashier_canonical_seat_v1(uuid,text)'::regprocedure),chr(13),''))<>'770a70ad4ae2226a2fdc82adf1e1f9ae'
 OR md5(replace(pg_get_functiondef('public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure),chr(13),''))<>'b542d17a8b823a3d934a8fb6e29f9f50'
 THEN RAISE EXCEPTION 'reentry115_catalog_or_dependency_drift';END IF;
END $$;
CREATE FUNCTION public.cashier_create_app_reentry_v1(p_tournament_id uuid,p_player_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tour public.tournaments%ROWTYPE; source_entry public.tournament_entries%ROWTYPE;
 registration public.tournament_registrations%ROWTYPE; total bigint; snapshot jsonb;
 ref text; attempt integer; existing_count bigint;
BEGIN
 -- Edge authenticates the player before supplying this identity. No browser
 -- EXECUTE grant: accepting an arbitrary player is service-only, as initial registration.
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 IF p_tournament_id IS NULL OR p_player_id IS NULL THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR tour.club_id IS NULL OR tour.deleted_at IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'error','tournament_not_found');END IF;
 IF NOT public.cashier_tour_active_v1(tour.club_id) THEN
  RETURN jsonb_build_object('ok',false,'error','cashier_tour_disabled');END IF;
 IF tour.status IN ('completed','cancelled') OR
  (tour.current_level IS NOT NULL AND tour.current_level>coalesce(tour.late_reg_close_level,6)) THEN
  RETURN jsonb_build_object('ok',false,'error','reentry_window_closed');END IF;
 SELECT * INTO source_entry FROM public.tournament_entries WHERE tournament_id=tour.id AND player_id=p_player_id
  ORDER BY entry_no DESC,id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','source_entry_not_found');END IF;
 IF source_entry.status<>'busted' THEN RETURN jsonb_build_object('ok',false,'error','entry_not_reenterable');END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id=tour.id AND player_id=p_player_id AND is_active) THEN
  RETURN jsonb_build_object('ok',false,'error','player_already_active');END IF;
 SELECT count(*) INTO existing_count FROM public.tournament_registrations
  WHERE source_entry_id=source_entry.id AND status IN ('pending','confirmed');
 IF existing_count>1 THEN RETURN jsonb_build_object('ok',false,'error','ambiguous_reentry_registration');END IF;
 IF existing_count=1 THEN
  SELECT * INTO STRICT registration FROM public.tournament_registrations
   WHERE source_entry_id=source_entry.id AND status IN ('pending','confirmed');
  IF registration.player_id IS DISTINCT FROM p_player_id OR registration.tournament_id IS DISTINCT FROM tour.id
   OR registration.club_id IS DISTINCT FROM tour.club_id THEN
   RETURN jsonb_build_object('ok',false,'error','registration_identity_mismatch');END IF;
  IF registration.status='confirmed' THEN RETURN jsonb_build_object('ok',false,'error','reentry_already_confirmed');END IF;
  IF registration.price_snapshot IS NULL OR (registration.price_snapshot->>'total_pay')::bigint IS DISTINCT FROM registration.total_pay THEN
   RETURN jsonb_build_object('ok',false,'error','legacy_reentry_price_requires_review');END IF;
 ELSE
  IF tour.buy_in IS NULL OR tour.buy_in<=0 OR coalesce(tour.rake_amount,0)<0 OR coalesce(tour.service_fee_amount,0)<0 THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_tournament_price');END IF;
  total:=tour.buy_in+coalesce(tour.rake_amount,0)+coalesce(tour.service_fee_amount,0);
  IF total<=0 OR total>9007199254740991 THEN RETURN jsonb_build_object('ok',false,'error','invalid_tournament_price');END IF;
  snapshot:=jsonb_build_object('buy_in',tour.buy_in,'rake',coalesce(tour.rake_amount,0),'waived_rake',0,
   'service_fee',coalesce(tour.service_fee_amount,0),'platform_fee',0,'total_pay',total,
   'free_rake_applied',false,'reentry',true,'source_entry_id',source_entry.id);
  FOR attempt IN 1..5 LOOP
   ref:='REENTRY-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
   BEGIN
    INSERT INTO public.tournament_registrations(tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
     reference_code,status,source_entry_id,used_free_rake,price_snapshot)
    VALUES(tour.id,p_player_id,tour.club_id,tour.buy_in,0,total,ref,'pending',source_entry.id,false,snapshot)
    RETURNING * INTO registration;
    EXIT;
   EXCEPTION WHEN unique_violation THEN IF attempt=5 THEN RAISE;END IF;END;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('ok',true,'already_registered',existing_count=1,'registration_id',registration.id,
  'status',registration.status,'reference_code',registration.reference_code,'total_pay',registration.total_pay,
  'committed_at',registration.committed_at,'price_snapshot',registration.price_snapshot,
  'transfer_proof_image_url',registration.transfer_proof_image_url,'transfer_proof_submitted',registration.transfer_proof_submitted);
END $$;
REVOKE ALL ON FUNCTION public.cashier_create_app_reentry_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_create_app_reentry_v1(uuid,uuid) TO service_role;
COMMIT;
