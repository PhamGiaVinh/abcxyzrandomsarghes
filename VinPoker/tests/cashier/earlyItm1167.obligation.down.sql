-- Empty-history code inverse ONLY. Run before1166/1165/1162 recovery.
-- Any retained obligation/receipt requires forward repair; never delete debt.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1) OR EXISTS(SELECT 1 FROM private.multi_day_individual_obligation_requests_v1) THEN RAISE EXCEPTION 'individual_obligation_history_retained_use_forward_repair';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='b488cd186a04195aab9a70edc296f93a') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='multi_day_individual_obligation_quote_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_obligation_down_body_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='122d5ef2b037d12f0af536a31ab4553f') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='multi_day_individual_obligation_budget_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_obligation_down_body_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='d62f0e526f70981506449646d2d1cef1') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_multi_day_individual_obligation_preview_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_obligation_down_body_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='365cee67945bacc157cdb0d3b2478574') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='confirm_multi_day_individual_obligation_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_obligation_down_body_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='de78a2dd4dbeae148b801464e1dda879') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_multi_day_individual_obligation_receipt_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'individual_obligation_down_body_drift';END IF;
END $guard$;
DROP FUNCTION public.get_multi_day_individual_obligation_receipt_v1(uuid,uuid);
DROP FUNCTION public.confirm_multi_day_individual_obligation_v1(uuid,uuid,text,text,text,uuid);
DROP FUNCTION public.get_multi_day_individual_obligation_preview_v1(uuid,uuid);
DROP FUNCTION private.multi_day_individual_obligation_budget_v1(uuid,jsonb);
CREATE OR REPLACE FUNCTION private.multi_day_individual_obligation_quote_v1(p_participation_id uuid)
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
DROP TABLE private.multi_day_individual_obligation_requests_v1;
DROP TABLE private.multi_day_individual_obligations_v1;
