-- LOCAL source candidate. Verified incoming source projection only, no reserve,
-- obligation, outgoing payment or global finalization. Guarded transaction only.
DO $build$
DECLARE definition text;prefix text;identity_check text;price_checks text;revisions text;
 result_start text:=' IF EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p';
 result_end text:=' IF EXISTS(SELECT 1 FROM public.multi_day_final_adjustments_v1 a';
 payment_start text:=' SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('||chr(10)||'    ''id'',m.id,''playerId'',m.recipient_ref,''amountVnd'',m.prize_amount,''status'',m.status)';
 result_pos integer;adjustment_pos integer;payment_pos integer;revision_pos integer;input_pos integer;
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure))
   IS DISTINCT FROM 'f24aa8981ff331dae9a9142f85603621'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.multi_day_payout_preview_v1(uuid)'::regprocedure))
   IS DISTINCT FROM '391d3632fea66c8b276a478b2d8a168c'
 OR to_regprocedure('private.multi_day_funding_evaluate_v1(uuid,jsonb)') IS NOT NULL
 OR to_regprocedure('private.multi_day_verified_funding_source_v1(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_funding_source_dependency_drift';END IF;
 definition:=pg_get_functiondef('private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure);
 result_pos:=strpos(definition,result_start);adjustment_pos:=strpos(definition,result_end);
 payment_pos:=strpos(definition,payment_start);revision_pos:=strpos(definition,' -- A seeded historical row');
 input_pos:=strpos(definition,' v_input_hash:=');
 IF result_pos=0 OR adjustment_pos<=result_pos OR payment_pos<=adjustment_pos
 OR revision_pos<=payment_pos OR input_pos<=revision_pos
 THEN RAISE EXCEPTION 'individual_funding_source_anchor_drift';END IF;
 prefix:=left(definition,result_pos-1);
 identity_check:=substring(definition FROM result_pos FOR adjustment_pos-result_pos);
 IF array_length(string_to_array(identity_check,'e.finished_place IS NULL'),1)<>2
 OR array_length(string_to_array(identity_check,'e.finished_place IS NOT NULL'),1)<>2
 THEN RAISE EXCEPTION 'individual_funding_identity_anchor_drift';END IF;
 identity_check:=replace(identity_check,'e.finished_place IS NULL','e.id IS NULL');
 identity_check:=replace(identity_check,' AND e.finished_place IS NOT NULL','');
 identity_check:=replace(identity_check,'multi_day_payout_results_not_ready','multi_day_funding_participation_identity_invalid');
 price_checks:=substring(definition FROM adjustment_pos FOR payment_pos-adjustment_pos);
 revisions:=substring(definition FROM revision_pos FOR input_pos-revision_pos);
 prefix:=replace(prefix,'FUNCTION private.multi_day_payout_evaluate_v2(', 'FUNCTION private.multi_day_funding_evaluate_v1(');
 -- Same canonical paid-source classification, overlay totals, qualification,
 -- persisted prize validation and revision expressions. No invented results.
 EXECUTE prefix||identity_check||price_checks||$tail$
 IF p_proposed_rows IS NOT NULL THEN RAISE EXCEPTION 'individual_funding_persisted_prizes_required';END IF;
 IF EXISTS(SELECT 1 FROM generate_series(1,v_itm_places)n LEFT JOIN public.tournament_prizes q
   ON q.tournament_id=v_rules.final_tournament_id AND q.position=n
   GROUP BY n HAVING count(q.position)<>1 OR count(q.amount)<>1)
 THEN RAISE EXCEPTION 'multi_day_payout_rank_amount_missing' USING ERRCODE='23514';END IF;
$tail$||revisions||$tail$
 v_input_hash:=md5(jsonb_build_object('rules',v_rules_version,'funding',v_funding_revision,
  'qualification',v_qualification_revision,'prizes',v_prize_rows)::text);
 IF greatest(v_direct,v_transfer_pool,v_fee,v_recorded_overlay)>9007199254740991
 THEN RAISE EXCEPTION 'multi_day_payout_amount_overflow' USING ERRCODE='22003';END IF;
 RETURN jsonb_build_object('ok',true,'eventId',p_event_id,'finalTournamentId',v_rules.final_tournament_id,
  'state','INCOMING_SOURCE_VERIFIED','itmPlaces',v_itm_places,'rulesVersion',v_rules_version,
  'fundingRevision',v_funding_revision,'qualificationRevision',v_qualification_revision,'sourceInputHash',v_input_hash,
  'directPoolVnd',v_direct::bigint,'transferPoolVnd',v_transfer_pool::bigint,'feesVnd',v_fee::bigint,
  'recordedOverlayVnd',v_recorded_overlay::bigint,'prizePositions',v_prize_rows,
  'obligationPersistence','NOT_PERFORMED','paymentExecution','NOT_PERFORMED',
  'sourceSnapshot',jsonb_build_object('registrations',v_source,'overlayRecords',v_overlay_rows));
END $function$;
$tail$;
 definition:=pg_get_functiondef('public.multi_day_payout_preview_v1(uuid)'::regprocedure);
 IF array_length(string_to_array(definition,'v_result:=private.multi_day_payout_unverified_v1(p_event_id);'),1)<>2
 THEN RAISE EXCEPTION 'individual_funding_bank_wrapper_anchor_drift';END IF;
 definition:=replace(definition,'FUNCTION public.multi_day_payout_preview_v1(', 'FUNCTION private.multi_day_verified_funding_source_v1(');
 definition:=replace(definition,'v_result:=private.multi_day_payout_unverified_v1(p_event_id);',
   'v_result:=private.multi_day_funding_evaluate_v1(p_event_id,NULL);');
 definition:=replace(definition,'payoutInputHash','sourceInputHash');
 EXECUTE definition;
END $build$;
REVOKE ALL ON FUNCTION private.multi_day_funding_evaluate_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.multi_day_verified_funding_source_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
