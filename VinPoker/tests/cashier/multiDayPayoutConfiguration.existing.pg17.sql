-- Run ONLY inside the uncommitted216 candidate transaction; caller ROLLBACKs.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_port()=55441;
 ASSERT (SELECT status FROM public.tournaments WHERE id='4cd3af4d-7e1d-4042-855f-04fb6777e580')='completed';
 ASSERT (SELECT count(*) FROM public.tournament_prizes WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=0;
END $$;
CREATE TEMP TABLE configuration196_gate ON COMMIT DROP AS SELECT * FROM public.multi_day_package_release_v1;
CREATE TEMP TABLE configuration196_before ON COMMIT DROP AS
 SELECT md5(jsonb_build_object(
   'prizes',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.tournament_prizes q),
   'payments',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.tournament_prize_payments q),
   'overlay',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.multi_day_overlay_funding_v1 q),
   'entries',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.tournament_entries q WHERE q.tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
   'finalizations',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.event_id) FROM public.multi_day_payout_finalizations_v1 q),
   'cash',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.cashier_buyin_movements q)
 )::text) AS hash;
UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $$
DECLARE event uuid:='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'; result jsonb; changed jsonb;
 minimum jsonb:='[{"position":1,"amount":110000},{"position":2,"amount":110000},{"position":3,"amount":110000},{"position":4,"amount":110000}]';
 invalid jsonb;
BEGIN
 BEGIN
   PERFORM public.multi_day_payout_preview_v1(event);
   RAISE EXCEPTION 'legacy preview silently accepted missing persisted prizes';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_payout_rank_amount_missing'; END;
 result:=public.multi_day_payout_configuration_preview_v1(event,minimum);
 ASSERT result->>'configurationRevision'=md5('[]');
 ASSERT result->>'state'='REQUIRED_SHORTFALL';
 ASSERT (result->>'directPoolVnd')::bigint=1600000;
 ASSERT (result->>'feesVnd')::bigint=240000;
 ASSERT (result->>'recordedOverlayVnd')::bigint=0;
 ASSERT (result->>'requiredShortfallVnd')::bigint=160000;
 ASSERT (result->>'unpaidObligationVnd')::bigint=1760000;
 ASSERT (result->>'itmPlaces')::integer=4;
 ASSERT jsonb_array_length(result->'obligations')=15;
 ASSERT (SELECT sum((r->>'totalVnd')::bigint) FROM jsonb_array_elements(result->'obligations') r)=1760000;
 ASSERT result->>'previewOnly'='true' AND result->>'configurationPersistence'='NOT_PERFORMED'
   AND result->>'paymentExecution'='NOT_PERFORMED';
 ASSERT public.multi_day_payout_configuration_preview_v1(event,'[{"position":4,"amount":110000},{"position":3,"amount":110000},{"position":2,"amount":110000},{"position":1,"amount":110000}]')=result;
 changed:=public.multi_day_payout_configuration_preview_v1(event,'[{"position":1,"amount":850000},{"position":2,"amount":110000},{"position":3,"amount":110000},{"position":4,"amount":110000}]');
 ASSERT (changed->>'unpaidObligationVnd')::bigint=2500000;
 ASSERT (changed->>'requiredShortfallVnd')::bigint=900000;
 ASSERT changed->>'payoutInputHash'<>result->>'payoutInputHash';
 ASSERT changed->>'fundingRevision'=result->>'fundingRevision';
 ASSERT changed->>'configurationRevision'=result->>'configurationRevision';
 FOR invalid IN SELECT value FROM jsonb_array_elements('[null,{},[{}],[{"position":"1","amount":110000}],[{"position":1.5,"amount":110000}],[{"position":1,"amount":-1}],[{"position":1,"amount":1.1}],[{"position":1,"amount":110000},{"position":1,"amount":110000}]]') LOOP
   BEGIN
     PERFORM public.multi_day_payout_configuration_preview_v1(event,invalid);
     RAISE EXCEPTION 'malformed proposal accepted';
   EXCEPTION WHEN invalid_parameter_value THEN ASSERT SQLERRM='multi_day_payout_proposal_invalid'; END;
 END LOOP;
 BEGIN
   PERFORM public.multi_day_payout_configuration_preview_v1(event,NULL);
   RAISE EXCEPTION 'null proposal accepted';
 EXCEPTION WHEN invalid_parameter_value THEN ASSERT SQLERRM='multi_day_payout_proposal_required'; END;
 BEGIN
   PERFORM public.multi_day_payout_configuration_preview_v1(event,minimum||'[{"position":5,"amount":1}]'::jsonb);
   RAISE EXCEPTION 'non-ITM ranked award accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_payout_non_itm_prize'; END;
 RAISE NOTICE 'MULTIDAY196_REAL_FUNDING_FLOORS_HASH_PROPOSAL_VALIDATION_PASS';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM public.multi_day_payout_configuration_preview_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d','[]');
   RAISE EXCEPTION 'outsider accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_payout_actor_or_qualification_denied'; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.multi_day_payout_configuration_preview_v1(uuid,jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.multi_day_payout_configuration_preview_v1(uuid,jsonb)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.multi_day_payout_configuration_preview_v1(uuid,jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','private.multi_day_payout_evaluate_v2(uuid,jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','private.multi_day_payout_prize_rows_v1(uuid,jsonb)','EXECUTE');
 ASSERT (SELECT hash FROM configuration196_before)=
   md5(jsonb_build_object(
     'prizes',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.tournament_prizes q),
     'payments',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.tournament_prize_payments q),
     'overlay',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.multi_day_overlay_funding_v1 q),
     'entries',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.tournament_entries q WHERE q.tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),
     'finalizations',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.event_id) FROM public.multi_day_payout_finalizations_v1 q),
     'cash',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.cashier_buyin_movements q)
   )::text);
 RAISE NOTICE 'MULTIDAY196_ACL_TENANT_NO_CONFIGURATION_MONEY_ENTRY_DELTA_PASS';
END $$;
