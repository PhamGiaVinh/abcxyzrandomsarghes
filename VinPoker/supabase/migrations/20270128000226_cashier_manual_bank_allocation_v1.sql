-- CLI-created 20261021022441, catalog reservation226 checked local 2026-10-21.
-- Guarded insertion preserves the exact legacy unpriced branch and existing ACL.
-- Rollback: revert consumer; forward restore reviewed prior definition only after
-- assessing new allocations. Never delete movements or clear paid markers.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $migration$
DECLARE definition text; body text; anchor text:='  v_confirm := public.confirm_registration_and_assign_seat(p_registration_id, v_actor, ''random_balanced'');';
 branch text:=$branch$
  IF v_reg.price_snapshot IS NOT NULL THEN
    IF NOT public.cashier_tour_active_v1(v_club) THEN
      RETURN jsonb_build_object('ok',false,'error','cashier_tour_disabled'); END IF;
    IF v_reg.club_id IS DISTINCT FROM v_club OR v_reg.status<>'pending'
      OR (v_reg.price_snapshot->>'total_pay')::bigint IS DISTINCT FROM v_reg.total_pay THEN
      RETURN jsonb_build_object('ok',false,'error','invalid_priced_registration'); END IF;
    IF v_bt.provider<>'sepay' OR v_bt.transfer_type IS DISTINCT FROM 'in' OR v_bt.amount<=0 THEN
      RETURN jsonb_build_object('ok',false,'error','invalid_incoming_bank_transfer'); END IF;
    IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE bank_transaction_id=v_bt.id) THEN
      RETURN jsonb_build_object('ok',false,'error','bank_movement_already_recorded'); END IF;
    IF v_bt.status<>'unmatched' THEN RETURN jsonb_build_object('ok',false,'error','bank_not_actionable'); END IF;
    PERFORM 1 FROM public.tournaments WHERE id=v_reg.tournament_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.tournaments WHERE id=v_reg.tournament_id AND status IN('completed','cancelled'))
      OR public.is_tournament_registration_closed(v_reg.tournament_id) THEN
      RETURN jsonb_build_object('ok',false,'error','registration_closed'); END IF;
    SELECT coalesce(sum(applied_amount),0) INTO v_paid FROM public.cashier_buyin_movements
      WHERE registration_id=v_reg.id AND purpose='buyin' AND direction='in';
    v_applied:=least(v_bt.amount,greatest(v_reg.total_pay-v_paid,0));
    INSERT INTO public.cashier_buyin_movements
      (club_id,tournament_id,registration_id,bank_transaction_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
      VALUES(v_club,v_reg.tournament_id,v_reg.id,v_bt.id,'in','bank','buyin',v_bt.amount,v_applied,v_actor,'bank:'||v_bt.id::text);
    UPDATE public.bank_transactions SET status='matched',processed_at=now(),club_id=v_club WHERE id=v_bt.id;
    IF v_paid+v_applied<v_reg.total_pay THEN
      RETURN jsonb_build_object('ok',true,'outcome','partial_received','registration_id',v_reg.id,'club_id',v_club,
        'payment_state','partial','received',v_paid+v_applied,'remaining',v_reg.total_pay-v_paid-v_applied,
        'applied',v_applied,'surplus',v_bt.amount-v_applied);
    END IF;
    UPDATE public.tournament_registrations SET cashier_paid_at=coalesce(cashier_paid_at,now()) WHERE id=v_reg.id;
    BEGIN
      v_confirm:=public.cashier_try_seat_paid_v1(v_reg.id,v_actor);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.tournament_registrations SET cashier_seating_error='seating_exception' WHERE id=v_reg.id;
      v_confirm:=jsonb_build_object('ok',false,'payment_state','paid','seating_state','needs_review','error','seating_exception');
    END;
    INSERT INTO public.payment_settlements
      (bank_transaction_id,tournament_registration_id,club_id,amount,expected_amount,reference_code,outcome,confirmed_by,reason)
      VALUES(v_bt.id,v_reg.id,v_club,v_bt.amount,v_reg.total_pay,v_reg.reference_code,'manual_confirmed',v_actor,p_reason);
    RETURN jsonb_build_object('ok',true,'outcome',CASE
      WHEN v_confirm->>'seating_state'='seated' THEN 'manual_confirmed'
      WHEN v_confirm->>'seating_state'='waiting' THEN 'paid_waiting_seat' ELSE 'paid_seating_review' END,
      'registration_id',v_reg.id,'club_id',v_club,'payment_state','paid','applied',v_applied,
      'surplus',v_bt.amount-v_applied,'amount_mismatch',v_mismatch,'confirm',v_confirm);
  END IF;
$branch$;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc
 WHERE oid=to_regprocedure('public.manual_confirm_bank_transaction(uuid,uuid,text)');
 IF body IS NULL OR md5(body)<>'872eceb93526dfa2ee31b39da43b7adc' THEN RAISE EXCEPTION 'manual_bank226_definition_drift'; END IF;
 IF to_regprocedure('public.cashier_try_seat_paid_v1(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'manual_bank226_dependency_missing'; END IF;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'manual_bank226_anchor_drift'; END IF;
 definition:=replace(definition,'  v_err      text;','  v_err      text; v_paid bigint; v_applied bigint;');
 definition:=replace(definition,'WHERE id = p_registration_id;','WHERE id = p_registration_id FOR UPDATE;');
 EXECUTE replace(definition,anchor,branch||anchor);
END $migration$;
COMMIT;
