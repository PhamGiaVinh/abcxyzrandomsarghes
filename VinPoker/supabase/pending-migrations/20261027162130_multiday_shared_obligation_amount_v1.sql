-- LOCAL candidate. Shared existing arithmetic; no obligation/payment writer.
-- Execute only inside an explicit guarded transaction.
DO $$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure))
  IS DISTINCT FROM 'a75c2bfc3d7bf05d5ee05d830bda38dc'
 OR to_regclass('private.multi_day_individual_results_v1') IS NULL
 OR to_regprocedure('private.multi_day_obligation_amount_v1(numeric,numeric,numeric)') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_obligation_amount_dependency_drift';END IF;
END $$;
CREATE FUNCTION private.multi_day_obligation_amount_v1(p_rank_award numeric,p_floor numeric,p_nonselected_min_cash numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE amount numeric;
BEGIN
 IF p_rank_award IS NULL OR p_floor IS NULL OR p_nonselected_min_cash IS NULL
 OR p_rank_award::text IN('NaN','Infinity','-Infinity') OR p_floor::text IN('NaN','Infinity','-Infinity')
 OR p_nonselected_min_cash::text IN('NaN','Infinity','-Infinity')
 OR least(p_rank_award,p_floor,p_nonselected_min_cash)<0
 OR p_rank_award<>trunc(p_rank_award) OR p_floor<>trunc(p_floor) OR p_nonselected_min_cash<>trunc(p_nonselected_min_cash)
 THEN RAISE EXCEPTION 'multi_day_payout_fractional_or_invalid_obligation' USING ERRCODE='23514';END IF;
 amount:=greatest(p_rank_award,p_floor)+p_nonselected_min_cash;
 IF amount>9007199254740991 THEN RAISE EXCEPTION 'multi_day_payout_amount_overflow' USING ERRCODE='22003';END IF;
 RETURN amount;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_obligation_amount_v1(numeric,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE fn regprocedure:='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure;
 definition text;acl aclitem[];anchor text:='v_obligation:=greatest(v_per_player::numeric,v_floor)+v_min_cash;';
BEGIN
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_obligation_amount_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,'v_obligation:=private.multi_day_obligation_amount_v1(v_per_player::numeric,v_floor,v_min_cash);');
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_obligation_amount_acl_drift';END IF;
END $patch$;

CREATE FUNCTION private.multi_day_individual_obligation_quote_v1(p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE frozen private.multi_day_individual_results_v1;participant public.multi_day_final_participations_v1;
 entry public.tournament_entries;prize public.tournament_prizes;extra numeric;amount numeric;context jsonb;
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
 -- This staged quote requires a persisted rank amount. Missing non-ITM rows
 -- stay unavailable here until the shared funding/ITM source is integrated.
 IF (SELECT count(*) FROM public.tournament_prizes WHERE tournament_id=frozen.tournament_id AND position=frozen.finished_place)<>1
 THEN RAISE EXCEPTION 'individual_obligation_prize_amount_missing';END IF;
 SELECT * INTO STRICT prize FROM public.tournament_prizes WHERE tournament_id=frozen.tournament_id AND position=frozen.finished_place;
 SELECT coalesce(sum(amount_vnd),0) INTO extra FROM public.multi_day_nonselected_min_cash_v1
 WHERE participation_id=p_participation_id AND status='PENDING_FUNDING';
 IF participant.policy='SUM_STACKS' AND extra<>0 THEN RAISE EXCEPTION 'multi_day_payout_sum_stacks_extra_cash';END IF;
 amount:=private.multi_day_obligation_amount_v1(prize.amount,participant.participation_floor_vnd,extra);
 context:=jsonb_build_object('eventId',frozen.event_id,'participationId',p_participation_id,'entryId',entry.id,
  'playerId',frozen.player_id,'rank',frozen.finished_place,'rankSourceHash',frozen.source_hash,
  'prizeRow',to_jsonb(prize),'rankAwardVnd',prize.amount,'participationFloorVnd',participant.participation_floor_vnd,
  'nonselectedBagMinCashVnd',extra,'totalVnd',amount);
 RETURN context||jsonb_build_object('quoteHash',md5(context::text),'fundingState','NOT_VERIFIED',
  'obligationPersistence','NOT_PERFORMED','paymentExecution','NOT_PERFORMED');
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_obligation_quote_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
