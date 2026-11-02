-- LOCAL CANDIDATE. Immutable individual obligations only; NO payment writer.
-- Explicit guarded transaction; do not durably apply this partial package.
DO $$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_verified_funding_source_v1(uuid)'::regprocedure))
   IS DISTINCT FROM '99ce1551b75923a53fb9ac123a8db23b'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_individual_obligation_quote_v1(uuid)'::regprocedure))
   IS DISTINCT FROM '4278e6f3988ee6ed17236baf5eae63b1'
 OR to_regclass('private.multi_day_individual_obligations_v1') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_obligation_commit_dependency_drift';END IF;
END $$;

-- Same canonical amount rule, including explicit zero outside ITM when that
-- rank has no persisted row. A missing ITM row is never treated as zero.
CREATE OR REPLACE FUNCTION private.multi_day_individual_obligation_quote_v1(p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE frozen private.multi_day_individual_results_v1;participant public.multi_day_final_participations_v1;
 entry public.tournament_entries;prize public.tournament_prizes;extra numeric;amount numeric;context jsonb;funding jsonb;award numeric;
BEGIN
 SELECT * INTO frozen FROM private.multi_day_individual_results_v1 WHERE participation_id=p_participation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'individual_obligation_final_rank_required';END IF;
 SELECT * INTO STRICT participant FROM public.multi_day_final_participations_v1 WHERE id=p_participation_id;
 SELECT * INTO STRICT entry FROM public.tournament_entries WHERE id=frozen.entry_id;
 IF participant.event_id<>frozen.event_id OR participant.player_id<>frozen.player_id
 OR participant.final_tournament_id<>frozen.tournament_id OR entry.player_id<>frozen.player_id
 OR entry.entry_no<>frozen.entry_no OR entry.tournament_id<>frozen.tournament_id OR entry.status<>'busted'
 OR entry.finished_place IS NOT NULL AND entry.finished_place<>frozen.finished_place
 THEN RAISE EXCEPTION 'individual_obligation_result_identity_changed';END IF;
 funding:=private.multi_day_verified_funding_source_v1(frozen.event_id);
 IF (SELECT count(*) FROM public.tournament_prizes WHERE tournament_id=frozen.tournament_id AND position=frozen.finished_place)>1
 THEN RAISE EXCEPTION 'individual_obligation_prize_amount_missing';END IF;
 SELECT * INTO prize FROM public.tournament_prizes WHERE tournament_id=frozen.tournament_id AND position=frozen.finished_place;
 IF NOT FOUND THEN
  IF frozen.finished_place<=(funding->>'itmPlaces')::integer THEN RAISE EXCEPTION 'individual_obligation_prize_amount_missing';END IF;
  award:=0;
 ELSE award:=prize.amount;END IF;
 SELECT coalesce(sum(amount_vnd),0) INTO extra FROM public.multi_day_nonselected_min_cash_v1
 WHERE participation_id=p_participation_id AND status='PENDING_FUNDING';
 IF participant.policy='SUM_STACKS' AND extra<>0 THEN RAISE EXCEPTION 'multi_day_payout_sum_stacks_extra_cash';END IF;
 amount:=private.multi_day_obligation_amount_v1(award,participant.participation_floor_vnd,extra);
 context:=jsonb_build_object('eventId',frozen.event_id,'participationId',p_participation_id,'entryId',entry.id,
  'playerId',frozen.player_id,'rank',frozen.finished_place,'rankSourceHash',frozen.source_hash,
  'prizeRow',CASE WHEN prize.id IS NULL THEN NULL ELSE to_jsonb(prize) END,'rankAwardVnd',award,
  'participationFloorVnd',participant.participation_floor_vnd,'nonselectedBagMinCashVnd',extra,'totalVnd',amount);
 RETURN context||jsonb_build_object('quoteHash',md5(context::text),'fundingState','NOT_VERIFIED',
  'obligationPersistence','NOT_PERFORMED','paymentExecution','NOT_PERFORMED');
END $$;

CREATE TABLE private.multi_day_individual_obligations_v1(
 participation_id uuid PRIMARY KEY REFERENCES private.multi_day_individual_results_v1(participation_id),
 event_id uuid NOT NULL REFERENCES public.tournament_events(id),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),entry_id uuid NOT NULL REFERENCES public.tournament_entries(id),
 player_id uuid NOT NULL,finished_place integer NOT NULL CHECK(finished_place>1),
 amount_vnd bigint NOT NULL CHECK(amount_vnd BETWEEN 0 AND 9007199254740991),
 quote_hash text NOT NULL CHECK(quote_hash~'^[a-f0-9]{32}$'),source_input_hash text NOT NULL CHECK(source_input_hash~'^[a-f0-9]{32}$'),
 budget_hash text NOT NULL CHECK(budget_hash~'^[a-f0-9]{32}$'),
 quote_snapshot jsonb NOT NULL,funding_snapshot jsonb NOT NULL,budget_snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(actor_id,request_id)
);
CREATE TABLE private.multi_day_individual_obligation_requests_v1(
 actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,event_id uuid NOT NULL REFERENCES public.tournament_events(id),
 payload jsonb NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.multi_day_individual_obligations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.multi_day_individual_obligation_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_individual_obligations_v1,private.multi_day_individual_obligation_requests_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER individual_obligation_immutable BEFORE UPDATE OR DELETE ON private.multi_day_individual_obligations_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE TRIGGER individual_obligation_request_immutable BEFORE UPDATE OR DELETE ON private.multi_day_individual_obligation_requests_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE FUNCTION private.multi_day_individual_obligation_budget_v1(p_event_id uuid,p_funding jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE field integer;floor_amount numeric;floors integer;extra numeric;total numeric;funded numeric;context jsonb;extras jsonb;
BEGIN
 IF p_funding->>'eventId' IS DISTINCT FROM p_event_id::text THEN RAISE EXCEPTION 'individual_obligation_budget_scope_invalid';END IF;
 SELECT count(*),count(DISTINCT participation_floor_vnd),min(participation_floor_vnd) INTO field,floors,floor_amount
 FROM public.multi_day_final_participations_v1 WHERE event_id=p_event_id;
 -- Canonical qualification computes one event floor for every participation.
 -- Reject drift, do not choose a new allocation policy for nonuniform data.
 IF field<2 OR floors<>1 THEN RAISE EXCEPTION 'individual_obligation_budget_nonuniform_floor';END IF;
 SELECT coalesce(sum(m.amount_vnd),0),coalesce(jsonb_agg(jsonb_build_object('participationId',m.participation_id,'id',m.id,'amountVnd',m.amount_vnd) ORDER BY m.id),'[]'::jsonb)
 INTO extra,extras FROM public.multi_day_nonselected_min_cash_v1 m JOIN public.multi_day_final_participations_v1 p ON p.id=m.participation_id
 WHERE p.event_id=p_event_id AND m.status='PENDING_FUNDING';
 IF EXISTS(SELECT 1 FROM public.multi_day_nonselected_min_cash_v1 m JOIN public.multi_day_final_participations_v1 p ON p.id=m.participation_id
  WHERE p.event_id=p_event_id AND m.status='PENDING_FUNDING' AND (m.amount_vnd<0 OR m.amount_vnd<>trunc(m.amount_vnd) OR p.policy='SUM_STACKS'))
 THEN RAISE EXCEPTION 'individual_obligation_budget_min_cash_invalid';END IF;
 -- Uniform event floor makes this full-field sum independent of unfinalized
 -- players' eventual rank. No player is provisionally assigned a rank.
 SELECT sum(private.multi_day_obligation_amount_v1(coalesce(q.amount,0),floor_amount,0)) INTO total
 FROM generate_series(1,field)n LEFT JOIN public.tournament_prizes q ON q.tournament_id=(p_funding->>'finalTournamentId')::uuid AND q.position=n;
 total:=total+extra;funded:=(p_funding->>'directPoolVnd')::numeric+(p_funding->>'transferPoolVnd')::numeric+(p_funding->>'recordedOverlayVnd')::numeric;
 IF total>9007199254740991 OR funded>9007199254740991 THEN RAISE EXCEPTION 'multi_day_payout_amount_overflow';END IF;
 IF EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 o
  JOIN public.multi_day_final_participations_v1 p ON p.id=o.participation_id
  LEFT JOIN public.tournament_prizes q ON q.tournament_id=o.tournament_id AND q.position=o.finished_place
  WHERE o.event_id=p_event_id AND o.amount_vnd IS DISTINCT FROM private.multi_day_obligation_amount_v1(coalesce(q.amount,0),p.participation_floor_vnd,
   (SELECT coalesce(sum(m.amount_vnd),0) FROM public.multi_day_nonselected_min_cash_v1 m WHERE m.participation_id=p.id AND m.status='PENDING_FUNDING')))
 THEN RAISE EXCEPTION 'individual_obligation_frozen_amount_changed';END IF;
 context:=jsonb_build_object('eventId',p_event_id,'field',field,'eventFloorVnd',floor_amount,'prizePositions',p_funding->'prizePositions',
  'nonselectedMinCash',extras,'requiredTotalVnd',total,'fundedVnd',funded,'requiredShortfallVnd',greatest(total-funded,0));
 RETURN context||jsonb_build_object('budgetHash',md5(context::text));
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_obligation_budget_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_multi_day_individual_obligation_preview_v1(p_event_id uuid,p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE funding jsonb;quote jsonb;budget jsonb;
BEGIN
 funding:=private.multi_day_verified_funding_source_v1(p_event_id);
 quote:=private.multi_day_individual_obligation_quote_v1(p_participation_id);
 IF quote->>'eventId' IS DISTINCT FROM p_event_id::text THEN RAISE EXCEPTION 'individual_obligation_scope_invalid';END IF;
 budget:=private.multi_day_individual_obligation_budget_v1(p_event_id,funding);
 RETURN jsonb_build_object('ok',true,'state',CASE WHEN (budget->>'requiredShortfallVnd')::numeric=0 THEN 'READY_TO_CONFIRM' ELSE 'REQUIRED_SHORTFALL' END,
  'quote',quote,'funding',funding,'budget',budget,'paymentExecution','NOT_PERFORMED');
END $$;
REVOKE ALL ON FUNCTION public.get_multi_day_individual_obligation_preview_v1(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_multi_day_individual_obligation_preview_v1(uuid,uuid) TO authenticated;

CREATE FUNCTION public.confirm_multi_day_individual_obligation_v1(p_event_id uuid,p_participation_id uuid,
 p_expected_quote_hash text,p_expected_source_hash text,p_expected_budget_hash text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;tour uuid;payload jsonb;preview jsonb;receipt jsonb;
 prior private.multi_day_individual_obligation_requests_v1;obligation private.multi_day_individual_obligations_v1;outcome text;
BEGIN
 SELECT club_id,final_tournament_id INTO club,tour FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR club IS NULL OR NOT(EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor)
  OR public.is_club_floor(actor,club)) THEN RAISE EXCEPTION 'individual_obligation_actor_denied' USING ERRCODE='42501';END IF;
 IF p_participation_id IS NULL OR p_request_id IS NULL OR p_expected_quote_hash IS NULL OR p_expected_quote_hash!~'^[a-f0-9]{32}$'
 OR p_expected_source_hash IS NULL OR p_expected_source_hash!~'^[a-f0-9]{32}$'
 OR p_expected_budget_hash IS NULL OR p_expected_budget_hash!~'^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'individual_obligation_request_invalid';END IF;
 payload:=jsonb_build_object('eventId',p_event_id,'participationId',p_participation_id,'quoteHash',p_expected_quote_hash,'sourceHash',p_expected_source_hash,'budgetHash',p_expected_budget_hash);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.multi_day_individual_obligation_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN prior.receipt;END IF;
 -- Same event-only fence as canonical whole-event payout finalization. Source
 -- writers take event SHARE; do not add registration/tournament locks here.
 PERFORM 1 FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
 THEN RAISE EXCEPTION 'individual_obligation_global_finalization_exists';END IF;
 preview:=public.get_multi_day_individual_obligation_preview_v1(p_event_id,p_participation_id);
 IF preview->'quote'->>'quoteHash' IS DISTINCT FROM p_expected_quote_hash
 OR preview->'funding'->>'sourceInputHash' IS DISTINCT FROM p_expected_source_hash
 OR preview->'budget'->>'budgetHash' IS DISTINCT FROM p_expected_budget_hash
 THEN RAISE EXCEPTION 'individual_obligation_source_changed';END IF;
 IF preview->>'state'<>'READY_TO_CONFIRM' THEN RAISE EXCEPTION 'individual_obligation_shortfall_unfunded';END IF;
 SELECT * INTO obligation FROM private.multi_day_individual_obligations_v1 WHERE participation_id=p_participation_id;
 IF FOUND THEN outcome:='already_finalized';ELSE
  INSERT INTO private.multi_day_individual_obligations_v1(participation_id,event_id,tournament_id,entry_id,player_id,finished_place,amount_vnd,
   quote_hash,source_input_hash,budget_hash,quote_snapshot,funding_snapshot,budget_snapshot,actor_id,request_id)
  VALUES(p_participation_id,p_event_id,tour,(preview->'quote'->>'entryId')::uuid,(preview->'quote'->>'playerId')::uuid,
   (preview->'quote'->>'rank')::integer,(preview->'quote'->>'totalVnd')::numeric,
   p_expected_quote_hash,p_expected_source_hash,p_expected_budget_hash,preview->'quote',preview->'funding',preview->'budget',actor,p_request_id)
  RETURNING * INTO obligation;
  outcome:='recorded';
 END IF;
 receipt:=jsonb_build_object('ok',true,'outcome',outcome,'eventId',p_event_id,'requestId',p_request_id,
  'obligation',to_jsonb(obligation),'paymentExecution','NOT_PERFORMED');
 INSERT INTO private.multi_day_individual_obligation_requests_v1(actor_id,request_id,event_id,payload,receipt) VALUES(actor,p_request_id,p_event_id,payload,receipt);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.confirm_multi_day_individual_obligation_v1(uuid,uuid,text,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_multi_day_individual_obligation_v1(uuid,uuid,text,text,text,uuid) TO authenticated;

CREATE FUNCTION public.get_multi_day_individual_obligation_receipt_v1(p_event_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;prior private.multi_day_individual_obligation_requests_v1;
BEGIN
 SELECT club_id INTO club FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR club IS NULL OR NOT(EXISTS(SELECT 1 FROM public.clubs WHERE id=club AND owner_id=actor)
  OR public.is_club_floor(actor,club)) THEN RAISE EXCEPTION 'individual_obligation_actor_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM private.multi_day_individual_obligation_requests_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND AND prior.event_id<>p_event_id THEN RAISE EXCEPTION 'individual_obligation_receipt_scope_conflict';END IF;
 RETURN jsonb_build_object('ok',true,'outcome',CASE WHEN prior.request_id IS NULL THEN 'not_found' ELSE 'recorded' END,'receipt',prior.receipt);
END $$;
REVOKE ALL ON FUNCTION public.get_multi_day_individual_obligation_receipt_v1(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_multi_day_individual_obligation_receipt_v1(uuid,uuid) TO authenticated;
