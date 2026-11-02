-- Captured exact qualified-local definition before124, digest a0577fcca58d4f12d342e54f8981a5a8.
-- Baseline reconstruction in a disposable LOCAL CLONE ONLY; never production.
CREATE OR REPLACE FUNCTION public.record_tournament_prize_payment(p_tournament_id uuid, p_finished_place integer, p_method text DEFAULT NULL::text, p_proof_url text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    uuid := auth.uid();
  v_tour     RECORD;
  v_authz    boolean;
  v_amount   numeric;
  v_entry    RECORD;
  v_recip    uuid;
  v_name     text;
  v_row      public.tournament_prize_payments;
  v_existing public.tournament_prize_payments;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  -- Authorization: club OWNER or club_cashier ONLY.
  SELECT EXISTS (
    SELECT 1 FROM public.clubs c
    LEFT JOIN public.club_cashiers cc ON cc.club_id = c.id AND cc.user_id = v_actor
    WHERE c.id = v_tour.club_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authz;
  IF NOT v_authz THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Server-derived AMOUNT (client cannot invent it).
  SELECT tp.amount INTO v_amount FROM public.tournament_prizes tp
  WHERE tp.tournament_id = p_tournament_id AND tp.position = p_finished_place;
  IF v_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'place_not_in_money');
  END IF;

  -- Server-derived RECIPIENT from the finalized finisher (place must be finalized).
  SELECT e.member_id, e.player_id INTO v_entry
  FROM public.tournament_entries e
  WHERE e.tournament_id = p_tournament_id AND e.finished_place = p_finished_place
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'place_not_finalized');
  END IF;
  v_recip := COALESCE(v_entry.member_id, v_entry.player_id);
  SELECT full_name INTO v_name FROM public.club_members WHERE id = v_entry.member_id;

  -- Idempotent insert (one 'paid' per tournament+place).
  INSERT INTO public.tournament_prize_payments (
    tournament_id, club_id, finished_place, prize_amount, recipient_ref, recipient_name,
    status, paid_by, method, proof_url, notes
  ) VALUES (
    p_tournament_id, v_tour.club_id, p_finished_place, v_amount, v_recip, v_name,
    'paid', v_actor, p_method, p_proof_url, p_notes
  )
  ON CONFLICT (tournament_id, finished_place) WHERE status = 'paid'
  DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_existing FROM public.tournament_prize_payments
    WHERE tournament_id = p_tournament_id AND finished_place = p_finished_place AND status = 'paid'
    LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'outcome', 'already_paid',
      'payment_id', v_existing.id, 'prize_amount', v_existing.prize_amount, 'paid_at', v_existing.paid_at);
  END IF;

  RETURN jsonb_build_object('ok', true, 'outcome', 'recorded',
    'payment_id', v_row.id, 'prize_amount', v_row.prize_amount, 'paid_at', v_row.paid_at);
END;
$function$
;
