-- Disposable PG17 only. Runs after real initial/re-entry Redeem race fixture.
-- No live DB; real historical seat-confirm RPCs produced both voucher seats.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000011',true);
SELECT set_config('test.satellite_ticket_id',id::text,true)
  FROM public.satellite_tickets
 WHERE source_tournament_id='d3000000-0000-4000-8000-000000000011'
   AND serial_no=1;
SELECT set_config('test.satellite_club_id',club_id::text,true)
  FROM public.satellite_tickets
 WHERE source_tournament_id='d3000000-0000-4000-8000-000000000011'
   AND serial_no=1;
SAVEPOINT satellite_reversal_role_authorization;
-- Exercise the RPC boundary as the real PostgREST roles. The correction
-- succeeds only with the server gate open, while a closed gate blocks both
-- mutation endpoints before writes. Savepoint rollback removes the probe.
UPDATE public.centerpoint_tournament_ops_release
   SET enabled=true,allowed_club_ids=ARRAY[current_setting('test.satellite_club_id')::uuid]
 WHERE id;
-- Use the repository's actual cashier assignment relation for a second club.
-- The actor is authorized in Club B, but not in the ticket's Club A.
INSERT INTO public.clubs(id,owner_id) VALUES
 ('d2000000-0000-4000-8000-000000000012',
  'd1000000-0000-4000-8000-000000000013');
INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES
 ('d2000000-0000-4000-8000-000000000012',
  'd1000000-0000-4000-8000-000000000012',
  'd1000000-0000-4000-8000-000000000013');
SELECT set_config('test.satellite_other_club_id',
  'd2000000-0000-4000-8000-000000000012',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_result jsonb;
BEGIN
  IF current_user<>'authenticated'
     OR has_table_privilege('authenticated','public.satellite_redemption_correction_requests','SELECT')
     OR has_table_privilege('authenticated','public.satellite_redemption_correction_requests','INSERT')
     OR has_table_privilege('authenticated','public.satellite_redemption_reversals','SELECT')
     OR has_table_privilege('authenticated','public.satellite_redemption_reversals','INSERT') THEN
    RAISE EXCEPTION 'authenticated direct write grants unexpectedly exposed';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid='public.satellite_redemption_correction_requests'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid='public.satellite_redemption_reversals'::regclass) THEN
    RAISE EXCEPTION 'reversal evidence tables are missing RLS';
  END IF;
  v_result:=public.satellite_request_redemption_correction_v1(
    current_setting('test.satellite_ticket_id')::uuid,
    'Authorization probe held for rollback','d9000000-0000-4000-8000-000000000004');
  IF v_result->>'status'<>'held' OR v_result->>'idempotent'<>'false' THEN
    RAISE EXCEPTION 'authenticated correction RPC failed: %',v_result;
  END IF;
END $$;
RESET ROLE;
UPDATE public.centerpoint_tournament_ops_release SET enabled=false WHERE id;
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_error text;
BEGIN
  BEGIN
    PERFORM public.satellite_request_redemption_correction_v1(
      current_setting('test.satellite_ticket_id')::uuid,
      'Closed gate correction probe','d9000000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'correction passed while package gate was closed';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      current_setting('test.satellite_ticket_id')::uuid,
      'd9000000-0000-4000-8000-000000000004',
      'Closed gate approval probe','d9000000-0000-4000-8000-000000000006');
    RAISE EXCEPTION 'approval passed while package gate was closed';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000012',true);
DO $$ DECLARE v_error text;
BEGIN
  IF auth.uid()<>'d1000000-0000-4000-8000-000000000012'::uuid
     OR NOT public.is_club_cashier(auth.uid(),current_setting('test.satellite_other_club_id')::uuid)
     OR public.is_club_cashier(auth.uid(),current_setting('test.satellite_club_id')::uuid) THEN
    RAISE EXCEPTION 'wrong-club fixture does not prove Club B cashier and Club A denial';
  END IF;
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      current_setting('test.satellite_ticket_id')::uuid,
      'd9000000-0000-4000-8000-000000000004',
      'Wrong owner role probe','d9000000-0000-4000-8000-000000000007');
    RAISE EXCEPTION 'non-owner authenticated actor approved reversal';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_reversal_owner_required' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.satellite_request_redemption_correction_v1(
      current_setting('test.satellite_ticket_id')::uuid,
      'Club B cashier attempted Club A ticket','d9000000-0000-4000-8000-000000000008');
    RAISE EXCEPTION 'Club B cashier accessed Club A ticket';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_correction_actor_not_allowed' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ DECLARE v_error text;
BEGIN
  IF has_table_privilege('anon','public.satellite_redemption_correction_requests','SELECT')
     OR has_table_privilege('anon','public.satellite_redemption_reversals','SELECT') THEN
    RAISE EXCEPTION 'anon direct table reads unexpectedly granted';
  END IF;
  IF has_function_privilege('anon',
       'public.satellite_request_redemption_correction_v1(uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('anon',
       'public.satellite_approve_redemption_reversal_v1(uuid,uuid,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon EXECUTE unexpectedly granted on reversal RPC';
  END IF;
  BEGIN
    PERFORM public.satellite_request_redemption_correction_v1(
      current_setting('test.satellite_ticket_id')::uuid,
      'Anonymous correction probe','d9000000-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'anon correction RPC executed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      current_setting('test.satellite_ticket_id')::uuid,
      'd9000000-0000-4000-8000-000000000004',
      'Anonymous approval probe','d9000000-0000-4000-8000-000000000010');
    RAISE EXCEPTION 'anon approval RPC executed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT satellite_reversal_role_authorization;
DO $$ DECLARE v_ticket uuid; v_reg uuid; v_transfer uuid; v_code uuid;
  v_correction uuid:='d9000000-0000-4000-8000-000000000001';
  v_request uuid:='d9000000-0000-4000-8000-000000000002';
  v_result jsonb; v_error text;
BEGIN
  IF has_table_privilege('authenticated','public.satellite_redemption_reversals','INSERT')
     OR has_table_privilege('service_role','public.satellite_redemption_reversals','INSERT') THEN
    RAISE EXCEPTION 'direct reversal writes exposed'; END IF;
  SELECT id,registration_id,redemption_code INTO v_ticket,v_reg,v_code
    FROM public.satellite_tickets
   WHERE source_tournament_id='d3000000-0000-4000-8000-000000000011'
     AND serial_no=1;
  SELECT id INTO v_transfer FROM public.satellite_ticket_value_transfers
   WHERE ticket_id=v_ticket;
  IF v_ticket IS NULL OR v_reg IS NULL OR v_transfer IS NULL THEN
    RAISE EXCEPTION 'reversal fixture missing real redeemed ticket'; END IF;
  v_result:=public.satellite_request_redemption_correction_v1(
    v_ticket,'Unused voucher issued to wrong bearer',v_correction);
  IF v_result->>'status'<>'held' THEN RAISE EXCEPTION 'correction not held'; END IF;
  v_result:=public.satellite_request_redemption_correction_v1(
    v_ticket,'Unused voucher issued to wrong bearer',v_correction);
  IF v_result->>'idempotent'<>'true' THEN RAISE EXCEPTION 'correction retry'; END IF;
  BEGIN
    PERFORM public.satellite_request_redemption_correction_v1(
      v_ticket,'A different reason',v_correction);
    RAISE EXCEPTION 'changed correction accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_correction_request_conflict' THEN RAISE; END IF;
  END;
  -- A recorded hand makes a paid voucher reversal unsafe. The exception
  -- subtransaction removes that hand without disabling a production guard.
  BEGIN
    INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number)
    VALUES('d3000000-0000-4000-8000-000000000012',
      'd4000000-0000-4000-8000-000000000011',1);
    BEGIN
      PERFORM public.satellite_approve_redemption_reversal_v1(
        v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
      RAISE EXCEPTION 'post-hand reversal accepted';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      IF v_error<>'satellite_reversal_unsafe_after_play_or_move' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION 'ROLLBACK_TEST_HAND';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'ROLLBACK_TEST_HAND' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.satellite_redemption_reversals
      WHERE ticket_id=v_ticket) THEN
    RAISE EXCEPTION 'unsafe reversal wrote compensation'; END IF;
  BEGIN
    UPDATE public.tournament_registrations SET status='cancelled' WHERE id=v_reg;
    RAISE EXCEPTION 'voucher cancelled without compensation';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_redemption_reversal_required' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.tournament_registrations WHERE id=v_reg;
    RAISE EXCEPTION 'voucher registration deleted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_redeemed_artifact_delete_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.tournament_entries WHERE registration_id=v_reg;
    RAISE EXCEPTION 'voucher entry deleted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_redeemed_artifact_delete_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
    SELECT e.tournament_id,e.player_id,e.entry_no,e.current_stack
      FROM public.tournament_entries e WHERE e.registration_id=v_reg;
    BEGIN
      PERFORM public.satellite_approve_redemption_reversal_v1(
        v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
      RAISE EXCEPTION 'post-chip-count reversal accepted';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      IF v_error<>'satellite_reversal_unsafe_after_play_or_move' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION 'ROLLBACK_TEST_CHIP_COUNT';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'ROLLBACK_TEST_CHIP_COUNT' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000012',true);
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
    RAISE EXCEPTION 'non-owner reversal accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_reversal_owner_required' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000011',true);
  v_result:=public.satellite_approve_redemption_reversal_v1(
    v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
  IF v_result->>'status'<>'reversed' OR v_result->>'idempotent'<>'false' THEN
    RAISE EXCEPTION 'approved reversal result %',v_result; END IF;
  v_result:=public.satellite_approve_redemption_reversal_v1(
    v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
  IF v_result->>'idempotent'<>'true' THEN RAISE EXCEPTION 'reversal retry'; END IF;
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      v_ticket,v_correction,'Different approval explanation',v_request);
    RAISE EXCEPTION 'changed reversal accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_reversal_request_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      v_ticket,v_correction,'Owner approved unused voucher reversal',
      'd9000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'second compensation accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_ticket_already_reversed' THEN RAISE; END IF;
  END;
  IF (SELECT status='cancelled' FROM public.tournament_registrations WHERE id=v_reg)
      IS DISTINCT FROM true
     OR (SELECT status='redeemed' AND registration_id=v_reg FROM public.satellite_tickets WHERE id=v_ticket)
        IS DISTINCT FROM true
     OR NOT EXISTS (SELECT 1 FROM public.satellite_redemption_reversals x
       JOIN public.tournament_entries e ON e.id=x.entry_id
       JOIN public.tournament_seats s ON s.id=x.seat_id
       JOIN public.seat_draw_receipts r ON r.id=x.receipt_id
       WHERE x.ticket_id=v_ticket AND e.status='cancelled' AND s.status='cancelled'
         AND NOT s.is_active AND r.status='cancelled')
     OR (SELECT count(*)=1 FROM public.satellite_ticket_value_transfers
         WHERE id=v_transfer) IS DISTINCT FROM true
     OR (SELECT count(*)=1 AND sum(target_debit_vnd)=6600000
         AND sum(source_credit_vnd)=6600000
         FROM public.satellite_redemption_reversals WHERE ticket_id=v_ticket)
        IS DISTINCT FROM true
     OR EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE registration_id=v_reg)
  THEN RAISE EXCEPTION 'reversal conservation/history failed'; END IF;
  v_result:=public.satellite_verify_ticket_v1(v_code);
  IF v_result->>'status'<>'reversed' OR v_result ? 'code' THEN
    RAISE EXCEPTION 'verify leaked code or missed reversal'; END IF;
  SELECT public.satellite_get_redemption_receipt_v1(r.request_id) INTO v_result
    FROM public.satellite_redemption_requests r WHERE r.ticket_id=v_ticket;
  IF v_result->>'status'<>'reversed' OR v_result->>'registrationId'<>v_reg::text THEN
    RAISE EXCEPTION 'server receipt did not show reversal'; END IF;
  BEGIN
    INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number)
    VALUES('d3000000-0000-4000-8000-000000000012',
      'd4000000-0000-4000-8000-000000000011',2);
    INSERT INTO public.hand_players(hand_id,tournament_id,player_id,
      entry_number,seat_number,starting_stack,ending_stack)
    SELECT h.id,h.tournament_id,e.player_id,e.entry_no,1,10000,10000
      FROM public.tournament_hands h JOIN public.tournament_entries e
        ON e.registration_id=v_reg WHERE h.hand_number=2;
    RAISE EXCEPTION 'reversed entry played';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_reversed_entry_cannot_play' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.satellite_ticket_value_transfers SET target_credit_vnd=1
      WHERE id=v_transfer;
    RAISE EXCEPTION 'original transfer changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.satellite_redemption_reversals SET target_debit_vnd=1
      WHERE ticket_id=v_ticket;
    RAISE EXCEPTION 'compensation changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
COMMIT;
