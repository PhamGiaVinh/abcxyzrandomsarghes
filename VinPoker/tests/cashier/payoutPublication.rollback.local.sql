-- Appended after the candidate migration inside one outer local-only transaction.
CREATE TEMP TABLE publication_before AS SELECT count(*) n,coalesce(sum(prize_amount),0) amount FROM public.tournament_prize_payments;
SET LOCAL request.jwt.claim.sub='4c1c76ad-d398-4326-9627-3fb60b82ba52';
SET LOCAL request.jwt.claims='{"sub":"4c1c76ad-d398-4326-9627-3fb60b82ba52","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$DECLARE tour uuid:='f2766bdd-5c30-4dee-bb3e-812f32d37172'; internal jsonb; recipients jsonb; context jsonb; result jsonb; BEGIN
 internal:=public.get_floor_tournament_prize_results_v1(tour);
 ASSERT internal->>'ok'='true' AND jsonb_array_length(internal->'items')=2,internal::text;
 ASSERT internal->'items'->0->>'playerName' IS NOT NULL;
 ASSERT strpos(internal::text,'confirmationToken')=0 AND strpos(internal::text,'recipientRef')=0;
 recipients:=public.get_tournament_payout_recipients(tour);
 SELECT value INTO STRICT context FROM jsonb_array_elements(recipients->'places') WHERE value->>'finishedPlace'='1';
 ASSERT context->>'isPaid'='false';
 PERFORM set_config('test.publication.context',context::text,true);
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub=''; SET LOCAL request.jwt.claims='{"role":"anon"}'; SET LOCAL ROLE anon;
DO $$DECLARE s jsonb; row jsonb; BEGIN
 s:=public.get_public_tournament_viewer_snapshot_v2('f2766bdd-5c30-4dee-bb3e-812f32d37172',array[]::uuid[],array['payout'],'{}');
 ASSERT s->'sections'->'payout'->'items'->0->>'playerName' IS NULL,s::text;
 ASSERT s->'sections'->'payout'->'items'->0->>'paymentConfirmed'='false';
 PERFORM set_config('test.publication.unpaid_revision',s->'sections'->'payout'->>'revision',true);
 BEGIN PERFORM public.get_floor_tournament_prize_results_v1('f2766bdd-5c30-4dee-bb3e-812f32d37172');
  RAISE EXCEPTION 'anon internal read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='4c1c76ad-d398-4326-9627-3fb60b82ba52';
SET LOCAL request.jwt.claims='{"sub":"4c1c76ad-d398-4326-9627-3fb60b82ba52","role":"authenticated"}'; SET LOCAL ROLE authenticated;
DO $$DECLARE c jsonb:=current_setting('test.publication.context')::jsonb; r jsonb; request uuid:=gen_random_uuid(); BEGIN
 r:=public.record_tournament_prize_payment_v2('f2766bdd-5c30-4dee-bb3e-812f32d37172',1,'cash',c->>'confirmationToken',request);
 ASSERT r->>'ok'='true' AND r->>'outcome'='recorded',r::text;
 ASSERT public.record_tournament_prize_payment_v2('f2766bdd-5c30-4dee-bb3e-812f32d37172',1,'cash',c->>'confirmationToken',request)=r;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub=''; SET LOCAL request.jwt.claims='{"role":"anon"}'; SET LOCAL ROLE anon;
DO $$DECLARE s jsonb; p jsonb; BEGIN
 s:=public.get_public_tournament_viewer_snapshot_v2('f2766bdd-5c30-4dee-bb3e-812f32d37172',array[]::uuid[],array['payout'],
   jsonb_build_object('payout',current_setting('test.publication.unpaid_revision')));
 p:=s->'sections'->'payout';
 ASSERT p->>'revision'<>current_setting('test.publication.unpaid_revision') AND p->>'unchanged'='false',s::text;
 ASSERT p->'items'->0->>'paymentConfirmed'='true' AND p->'items'->0->>'resultStatus'='official';
 ASSERT p->'items'->0->>'playerName'=current_setting('test.publication.context')::jsonb->>'recipientName';
 ASSERT p->'items'->1->>'paymentConfirmed'='false' AND p->'items'->1->>'playerName' IS NULL;
END $$;
RESET ROLE;
-- Canonical GLOBAL and INDIVIDUAL local fixtures, including paid and unpaid.
DO $$DECLARE t record; expected jsonb; snapshot jsonb; item jsonb; context jsonb; ground jsonb; proof jsonb;
 global boolean; count_paid integer:=0; count_unpaid integer:=0; individual_paid integer:=0; individual_unpaid integer:=0; BEGIN
 FOR t IN SELECT id,event_id FROM public.tournaments WHERE id IN (
  '664e6861-ec0b-4471-8902-672be2d30efe','6f0ebd0d-505b-4151-a8a9-bfe5b58ce34f',
  '93f7d1b3-0de0-4768-a539-7b1fb361e8cb','e25c75c1-6cf0-4b5b-bf92-55b7054a52f9') LOOP
  expected:=floor_private.tournament_prize_result_contexts_v1(t.id);
  ASSERT jsonb_array_length(expected)>0,'multi-day fixture must have obligations';
  global:=EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE final_tournament_id=t.id);
  ground:=CASE WHEN global THEN private.multi_day_payout_accounting_v1(t.event_id) ELSE private.multi_day_individual_payment_state_v1(t.event_id) END;
  ASSERT jsonb_array_length(expected)=jsonb_array_length(ground->'obligations');
  PERFORM set_config('request.jwt.claim.sub','',true); PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  PERFORM set_config('role','anon',true);
  snapshot:=public.get_public_tournament_viewer_snapshot_v2(t.id,array[]::uuid[],array['payout'],'{}');
  PERFORM set_config('role','none',true);
  ASSERT jsonb_array_length(snapshot->'sections'->'payout'->'items')=jsonb_array_length(expected);
  FOR context IN SELECT value FROM jsonb_array_elements(expected) LOOP
   IF global THEN
    SELECT g.value INTO STRICT proof FROM jsonb_array_elements(ground->'obligations') g
      JOIN public.multi_day_payout_finalizations_v1 f ON f.final_tournament_id=t.id
      JOIN LATERAL jsonb_array_elements(f.obligations) o ON o.value->>'participationId'=g.value->>'participationId'
      WHERE o.value->>'rank'=context->>'finishedPlace';
    ASSERT (context->>'prizeAmount')::numeric=(proof->>'currentTotalVnd')::numeric;
    ASSERT (context->>'paymentConfirmed')::boolean=((proof->>'currentUnpaidVnd')::numeric=0 AND (proof->>'currentPaidVnd')::numeric>0);
   ELSE
    SELECT g.value INTO STRICT proof FROM jsonb_array_elements(ground->'obligations') g
      JOIN private.multi_day_individual_obligations_v1 o ON o.participation_id=(g.value->>'participationId')::uuid
      WHERE o.tournament_id=t.id AND o.finished_place=(context->>'finishedPlace')::integer;
    ASSERT (context->>'prizeAmount')::numeric=(proof->>'totalVnd')::numeric;
    ASSERT (context->>'paymentConfirmed')::boolean=((proof->>'paidVnd')::numeric=(proof->>'totalVnd')::numeric AND (proof->>'paidVnd')::numeric>0);
    IF context->>'paymentConfirmed'='true' THEN individual_paid:=individual_paid+1; ELSE individual_unpaid:=individual_unpaid+1; END IF;
   END IF;
   SELECT value INTO STRICT item FROM jsonb_array_elements(snapshot->'sections'->'payout'->'items')
    WHERE value->>'fromPlace'=context->>'finishedPlace';
   ASSERT (item->>'amountPerPlayer')::numeric=(context->>'prizeAmount')::numeric;
   ASSERT item->>'paymentConfirmed'=context->>'paymentConfirmed';
   IF context->>'paymentConfirmed'='true' THEN
    ASSERT item->>'playerName'=context->>'recipientName'; count_paid:=count_paid+1;
   ELSE ASSERT item->>'playerName' IS NULL; count_unpaid:=count_unpaid+1; END IF;
  END LOOP;
 END LOOP;
 ASSERT count_paid>0 AND count_unpaid>0,'multi-day paid and unpaid paths must both execute';
 ASSERT individual_paid>0,'existing individual fixtures must exercise fully paid obligations';
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM public.get_floor_tournament_prize_results_v1('f2766bdd-5c30-4dee-bb3e-812f32d37172');
  RAISE EXCEPTION 'unrelated actor read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$BEGIN
 ASSERT (SELECT count(*) FROM public.tournament_prize_payments)=(SELECT n+1 FROM publication_before);
 ASSERT (SELECT coalesce(sum(prize_amount),0) FROM public.tournament_prize_payments)=(SELECT amount+200000 FROM publication_before);
END $$;
