-- Actual RPC/trigger/receipt/ledger/correction regression, all writes rollback.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_addr()<>'127.0.0.1'::inet
 OR inet_server_port()<>55441 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'isolated_d2_payment_test_required';END IF;
END $$;
INSERT INTO public.multi_day_package_release_v1(id,enabled,allowed_club_ids)
 SELECT true,true,ARRAY[f.club_id] FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id='30eb935c-8ba6-43ab-a6a6-0c0934f71570'
 ON CONFLICT(id) DO UPDATE SET enabled=true,allowed_club_ids=excluded.allowed_club_ids;
CREATE FUNCTION pg_temp.fail_d2_payment_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.multi_day_participation_id IS NOT NULL AND current_setting('test.d2_payment_fault',true)='true' THEN
  RAISE EXCEPTION 'LOCAL_TEST_D2_AFTER_PAYMENT_INSERT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_d2_payment_atomic_rollback AFTER INSERT ON public.tournament_prize_payments
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_d2_payment_after_insert();
DO $$
DECLARE event uuid:='30eb935c-8ba6-43ab-a6a6-0c0934f71570';tour uuid:='6f0ebd0d-505b-4151-a8a9-bfe5b58ce34f';
 actor uuid;club uuid;expected bigint:=300000;
 read jsonb;person jsonb; result jsonb; paid jsonb; state jsonb;request uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();
 snapshot text; denied boolean:=false;payments_before integer;cashier uuid:=gen_random_uuid();
BEGIN
 SELECT f.club_id,c.owner_id INTO STRICT club,actor FROM public.multi_day_payout_finalizations_v1 f JOIN public.clubs c ON c.id=f.club_id WHERE f.event_id=event;
 SELECT count(*) INTO payments_before FROM public.tournament_prize_payments WHERE tournament_id=tour;
 SELECT md5(to_jsonb(f)::text) INTO STRICT snapshot FROM public.multi_day_payout_finalizations_v1 f WHERE event_id=event;
 IF has_function_privilege('anon','public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)','EXECUTE')
  OR has_function_privilege('service_role','public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'payment_bridge_acl_failed';END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 result:=public.record_multi_day_prize_payment_v1(event,gen_random_uuid(),'cash',repeat('0',32),gen_random_uuid());
 IF result->>'error'<>'actor_not_allowed' THEN RAISE EXCEPTION 'outsider_payment_accepted';END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 -- Admin fixture probe deliberately bypasses RLS, but not the actual trigger.
 SELECT public.get_multi_day_payout_recipients_v1(event)->'places'->0 INTO person;
 BEGIN
  INSERT INTO public.tournament_prize_payments(tournament_id,club_id,finished_place,prize_amount,recipient_ref,multi_day_participation_id)
   VALUES(tour,club,1,expected,(person->>'recipientRef')::uuid,(person->>'multiDayParticipationId')::uuid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'forged_qualified_payment_accepted';END IF;
 PERFORM set_config('role','authenticated',true);
 read:=public.get_tournament_payout_recipients(tour);
 IF read->>'mode'<>'multi_day' OR jsonb_array_length(read->'places')<>8 OR (read->>'owedTotal')::bigint<>1600000 THEN RAISE EXCEPTION 'ordinary_read_not_routed: %',read;END IF;
 person:=read->'places'->0;
 IF (person->>'prizeAmount')::bigint<>expected THEN RAISE EXCEPTION 'entitlement_missing';END IF;
 denied:=false;PERFORM set_config('test.d2_payment_fault','true',true);
 BEGIN
  PERFORM public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',request);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'LOCAL_TEST_D2_AFTER_PAYMENT_INSERT' THEN RAISE;END IF;denied:=true;
 END;
 PERFORM set_config('test.d2_payment_fault','false',true);
 IF NOT denied OR public.get_tournament_prize_payment_receipt_v2(request)->>'found'<>'false'
  THEN RAISE EXCEPTION 'failed_payment_left_receipt';END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id=tour)<>payments_before THEN RAISE EXCEPTION 'failed_payment_left_money';END IF;
 IF EXISTS(SELECT 1 FROM private.multi_day_payment_commits_v1 WHERE event_id=event AND transaction_id=txid_current()) THEN RAISE EXCEPTION 'failed_payment_left_private_authorization';END IF;
 PERFORM set_config('role','authenticated',true);
 paid:=public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',request);
 IF paid->>'ok'<>'true' OR (paid->>'prize_amount')::bigint<>expected THEN RAISE EXCEPTION 'verified_payment_failed: %',paid;END IF;
 IF public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',request)<>paid THEN RAISE EXCEPTION 'exact_payment_replay_changed';END IF;
 result:=public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'bank',person->>'confirmationToken',request);
 IF result->>'error'<>'request_payload_conflict' THEN RAISE EXCEPTION 'changed_payment_payload_accepted';END IF;
 result:=public.get_tournament_prize_payment_receipt_v2(request);
 IF result->>'found'<>'true' OR result->'result'<>paid OR result->'payload'->>'participation_id'<>person->>'multiDayParticipationId' THEN RAISE EXCEPTION 'lost_response_receipt_failed';END IF;
 result:=public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',gen_random_uuid());
 IF result->>'error'<>'payout_confirmation_stale' THEN RAISE EXCEPTION 'stale_confirmation_accepted: %',result;END IF;
 state:=public.multi_day_payout_postfinal_state_v1(event);
 IF (state->>'paidPlayerVnd')::bigint<>expected OR (state->>'unpaidObligationVnd')::bigint<>1600000-expected THEN RAISE EXCEPTION 'paid_accounting_stale: %',state;END IF;
 read:=public.get_club_payout_liability_v2('2026-10-01','2026-10-31',club);
 IF (read->>'owedTotal')::bigint<>1600000 OR (read->>'paidTotal')::bigint<>expected OR (read->>'outstandingTotal')::bigint<>1600000-expected
 THEN RAISE EXCEPTION 'club_liability_not_same_obligations: %',read;END IF;
 result:=public.multi_day_request_payout_correction_v1(event,'PAYMENT_REVERSAL',(person->>'multiDayParticipationId')::uuid,
  (paid->>'payment_id')::uuid,-expected,state->>'revision','TEST wrong payout reversal','LOCAL-TEST-EVIDENCE',reversal);
 IF result->>'state'<>'PENDING_APPROVAL' THEN RAISE EXCEPTION 'new_payment_reversal_missing';END IF;
 result:=public.multi_day_approve_payout_correction_v1(reversal,gen_random_uuid());
 IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'reversal_approval_failed';END IF;
 state:=public.multi_day_payout_postfinal_state_v1(event);
 IF (state->>'paidPlayerVnd')::bigint<>0 OR (state->>'unpaidObligationVnd')::bigint<>1600000 THEN RAISE EXCEPTION 'reversal_accounting_failed';END IF;
 read:=public.get_club_payout_liability_v2('2026-10-01','2026-10-31',club);
 IF (read->>'paidTotal')::bigint<>0 OR (read->>'outstandingTotal')::bigint<>1600000 THEN RAISE EXCEPTION 'club_liability_ignores_reversal';END IF;
 read:=public.get_multi_day_payout_recipients_v1(event);person:=read->'places'->0;
 result:=public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',gen_random_uuid());
 IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'immutable_repayment_failed: %',result;END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id=tour)<>payments_before+2
 OR (SELECT count(*) FROM public.tournament_prize_payments WHERE id=(paid->>'payment_id')::uuid AND status='paid' AND prize_amount=expected)<>1 THEN RAISE EXCEPTION 'historical_payment_changed';END IF;
 IF (SELECT md5(to_jsonb(f)::text) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id=event)<>snapshot THEN RAISE EXCEPTION 'frozen_obligations_changed';END IF;
 INSERT INTO auth.users(id) VALUES(cashier);
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES(club,cashier);
 PERFORM set_config('request.jwt.claim.sub',cashier::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',cashier)::text,true);
 PERFORM set_config('role','authenticated',true);
 read:=public.get_multi_day_payout_recipients_v1(event);person:=read->'places'->7;
 IF (person->>'finishedPlace')::integer<>8 OR (person->>'prizeAmount')::bigint<>100000 THEN RAISE EXCEPTION 'outside_itm_floor_missing';END IF;
 result:=public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',gen_random_uuid());
 IF result->>'ok'<>'true' OR (result->>'prize_amount')::bigint<>100000 THEN RAISE EXCEPTION 'exact_club_cashier_floor_payment_failed: %',result;END IF;
 IF public.get_tournament_prize_payment_receipt_v2(request)->>'found'<>'false' THEN RAISE EXCEPTION 'cashier_saw_owner_receipt';END IF;
 PERFORM set_config('role','none',true);
 denied:=false;
 BEGIN
  INSERT INTO public.tournament_prize_payments(tournament_id,club_id,finished_place,prize_amount,recipient_ref)
  SELECT tournament_id,club_id,finished_place,prize_amount,recipient_ref FROM public.tournament_prize_payments
  WHERE tournament_id='5875d8a8-b55f-4dbf-b462-46404d3ae04e' AND finished_place=1 AND status='paid';
 EXCEPTION WHEN unique_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'ordinary_once_per_place_uniqueness_lost';END IF;
END $$;
ROLLBACK;
SELECT 'D2_VERIFIED_PAY_RECEIPT_REPLAY_CAS_REVERSAL_REPAY_SNAPSHOT_IMMUTABLE_ROLLBACK_PASS';
