-- LOCAL ONLY: run after candidate216 + existing configuration fixture, within
-- one transaction that the caller MUST ROLLBACK. No fabricated bank evidence.
DO $$
DECLARE
 event uuid:='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 minimum jsonb;
 guarantee bigint;
 funded bigint;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_port()=55441;
 SELECT guarantee_amount INTO guarantee FROM public.tournament_events WHERE id=event;
 ASSERT guarantee=2500000;
 -- Configuration196 fixture leaves the owner claims but RESETs its SQL role.
 PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
 PERFORM set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
 minimum:=public.multi_day_payout_configuration_preview_v1(event,
   '[{"position":1,"amount":110000},{"position":2,"amount":110000},{"position":3,"amount":110000},{"position":4,"amount":110000}]');
 funded:=(minimum->>'directPoolVnd')::bigint+(minimum->>'transferPoolVnd')::bigint+
   (minimum->>'recordedOverlayVnd')::bigint;
 ASSERT funded=1600000;
 ASSERT (minimum->>'feesVnd')::bigint=240000; -- Fees do not fund GTD.
 ASSERT guarantee-funded=900000; -- Owner: club funds FULL event GTD.
 ASSERT (minimum->>'requiredShortfallVnd')::bigint=160000;
 ASSERT guarantee-funded>(minimum->>'requiredShortfallVnd')::bigint;
 ASSERT NOT EXISTS(SELECT 1 FROM public.bank_transactions WHERE club_id=
   'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(event,'RECORDED',900000,
     'LOCAL_GTD_DECISION_NO_PROOF','TEST club must fund full shared event GTD',
     NULL,NULL,'85f6c6be-aa80-4c0d-b51e-2b28df702211');
   RAISE EXCEPTION 'text-only overlay incorrectly accepted without funding proof';
 EXCEPTION WHEN check_violation THEN
   ASSERT SQLERRM='multi_day_overlay_bank_proof_required';
 END;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(event,'RECORDED',900000,
     'LOCAL_GTD_DECISION_NO_PROOF','TEST club must fund full shared event GTD',
     NULL,NULL,'85f6c6be-aa80-4c0d-b51e-2b28df702211',NULL);
   RAISE EXCEPTION 'null bank proof incorrectly accepted';
 EXCEPTION WHEN invalid_parameter_value THEN
   ASSERT SQLERRM='multi_day_overlay_invalid';
 END;
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 WHERE event_id=event);
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=event);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=
   '4cd3af4d-7e1d-4042-855f-04fb6777e580');
 RAISE NOTICE 'MAIN_EVENT_GTD_FULL_900K_NOT_MINIMUM_160K_NO_FAKE_FUNDING_PASS';
END $$;
