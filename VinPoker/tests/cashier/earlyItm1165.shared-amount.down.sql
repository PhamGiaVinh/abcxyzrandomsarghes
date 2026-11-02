-- Exact code-only inverse; no obligation/payment writer exists in this package.
-- Explicit guarded transaction. Review downstream callers before any release rollback.
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure) IS DISTINCT FROM 'f24aa8981ff331dae9a9142f85603621' THEN RAISE EXCEPTION 'shared_obligation_down_evaluator_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='195d4cb25753ae9dd0693bbe4ed458cf') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='multi_day_obligation_amount_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'shared_obligation_down_helper_drift';END IF;
 IF (SELECT count(*)=1 AND bool_and(md5(p.prosrc)='4278e6f3988ee6ed17236baf5eae63b1') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='multi_day_individual_obligation_quote_v1') IS DISTINCT FROM true THEN RAISE EXCEPTION 'shared_obligation_down_helper_drift';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION private.multi_day_payout_evaluate_v2(p_event_id uuid, p_proposed_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_lock public.multi_day_qualification_locks_v1%ROWTYPE;
 v_reg record; v_group record; v_player record; v_transfer record;
 v_source jsonb:='[]'::jsonb; v_overlay_rows jsonb:='[]'::jsonb;
 v_obligations jsonb:='[]'::jsonb; v_prize_rows jsonb:='[]'::jsonb;
 v_tie_batches jsonb:='[]'::jsonb;
 v_qualification_rows jsonb:='[]'::jsonb; v_payment_rows jsonb:='[]'::jsonb;
 v_direct numeric:=0; v_transfer_pool numeric:=0; v_fee numeric:=0;
 v_recorded_overlay numeric:=0; v_paid numeric:=0; v_unpaid numeric:=0;
 v_tie_remainder numeric:=0; v_required numeric; v_unallocated numeric;
 v_ledger numeric; v_movement_rows jsonb; v_count integer; v_next_rank integer:=1;
 v_itm_places integer; v_required_positions integer;
 v_group_size integer; v_rank_amounts bigint[]; v_rank_total bigint;
 v_split jsonb; v_per_player bigint; v_group_remainder bigint;
 v_min_cash numeric; v_floor numeric; v_obligation numeric; v_player_paid numeric;
 v_rules_version text; v_funding_revision text; v_qualification_revision text;
 v_input_hash text; v_tender text; v_transfer_id uuid;
 v_target_rake bigint; v_target_service_fee bigint; v_ticket_status text;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL THEN
   RAISE EXCEPTION 'multi_day_payout_auth_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 SELECT * INTO v_lock FROM public.multi_day_qualification_locks_v1 WHERE event_id=p_event_id;
 IF v_rules.event_id IS NULL OR v_lock.event_id IS NULL OR
    NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_rules.club_id AND
       (c.owner_id=v_actor OR public.is_club_floor(v_actor,v_rules.club_id))) THEN
   RAISE EXCEPTION 'multi_day_payout_actor_or_qualification_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_rules.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 IF v_rules.day2_percent IS NULL OR v_rules.itm_percent>v_rules.day2_percent THEN
   RAISE EXCEPTION 'multi_day_itm_day2_invalid' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(pg_catalog.ceil(x.valid_entries*v_rules.itm_percent/100)),0)::integer
 INTO v_itm_places FROM (
   SELECT t.id,count(e.id) FILTER (WHERE e.status<>'cancelled')::numeric valid_entries
   FROM public.tournaments t LEFT JOIN public.tournament_entries e ON e.tournament_id=t.id
   WHERE t.event_id=p_event_id AND t.phase='flight' AND t.deleted_at IS NULL
   GROUP BY t.id) x;
 IF v_itm_places<1 OR v_itm_places>v_lock.participation_count THEN
   RAISE EXCEPTION 'multi_day_payout_itm_capacity_invalid' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM private.multi_day_payout_prize_rows_v1(v_rules.final_tournament_id,p_proposed_rows) q
   WHERE q.tournament_id=v_rules.final_tournament_id AND
     q.position>v_itm_places AND q.amount<>0) THEN
   RAISE EXCEPTION 'multi_day_payout_non_itm_prize' USING ERRCODE='23514';
 END IF;
 IF to_regclass('public.satellite_ticket_value_transfers') IS NULL OR
    to_regclass('public.satellite_redemption_reversals') IS NULL OR
    to_regclass('public.satellite_tickets') IS NULL OR
    to_regprocedure('public.satellite_redeem_ticket_v1(uuid,uuid,uuid,uuid)') IS NULL OR
    to_regprocedure('public.satellite_approve_redemption_reversal_v1(uuid,uuid,text,uuid)') IS NULL THEN
   RAISE EXCEPTION 'multi_day_payout_transfer_dependency_missing' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournaments t WHERE t.event_id=p_event_id
    AND t.phase='flight' AND NOT EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
      WHERE f.flight_tournament_id=t.id AND f.status='locked')) OR
    EXISTS(SELECT 1 FROM public.tournaments t WHERE t.event_id=p_event_id
      AND t.phase='flight' AND NOT t.id=ANY(v_lock.flight_ids)) OR
    (SELECT count(*) FROM public.tournaments t WHERE t.event_id=p_event_id
      AND t.phase='flight')<>pg_catalog.cardinality(v_lock.flight_ids) THEN
   RAISE EXCEPTION 'multi_day_payout_flight_set_stale' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_registrations r
    JOIN public.tournaments t ON t.id=r.tournament_id
    WHERE t.event_id=p_event_id AND t.phase='flight'
      AND r.status='confirmed' AND NOT EXISTS(SELECT 1 FROM public.tournament_entries e
        WHERE e.registration_id=r.id AND e.tournament_id=r.tournament_id
          AND e.player_id=r.player_id AND e.status<>'cancelled')) OR
    EXISTS(SELECT 1 FROM public.tournament_entries e
      JOIN public.tournaments t ON t.id=e.tournament_id
      LEFT JOIN public.tournament_registrations r ON r.id=e.registration_id
      WHERE t.event_id=p_event_id AND t.phase='flight' AND e.status<>'cancelled'
        AND (r.id IS NULL OR r.status<>'confirmed' OR r.confirmed_at IS NULL
          OR r.tournament_id<>e.tournament_id OR r.player_id<>e.player_id)) OR
    EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
      LEFT JOIN public.tournament_registrations r ON r.id=m.registration_id
      JOIN public.tournaments t ON t.id=coalesce(m.tournament_id,r.tournament_id)
      WHERE t.event_id=p_event_id AND t.phase='flight'
        AND m.purpose IN('buyin','refund') AND
        (r.id IS NULL OR r.tournament_id<>t.id OR
          m.club_id IS DISTINCT FROM v_rules.club_id)) OR
    EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers x
      JOIN public.tournaments t ON t.id=x.target_tournament_id
      LEFT JOIN public.tournament_registrations r ON r.id=x.registration_id
      WHERE t.event_id=p_event_id AND t.phase='flight' AND
        (r.id IS NULL OR r.tournament_id<>t.id OR
         x.club_id IS DISTINCT FROM v_rules.club_id)) THEN
   RAISE EXCEPTION 'multi_day_payout_source_unmatched' USING ERRCODE='23514';
 END IF;
 FOR v_reg IN
   SELECT r.*,e.id entry_id,e.player_id entry_player,t.club_id flight_club
   FROM public.tournament_registrations r
   JOIN public.tournament_entries e ON e.registration_id=r.id
      AND e.tournament_id=r.tournament_id AND e.status<>'cancelled'
   JOIN public.tournaments t ON t.id=r.tournament_id
   WHERE t.event_id=p_event_id AND t.phase='flight'
   ORDER BY r.id,e.id
 LOOP
   IF v_reg.status<>'confirmed' OR v_reg.confirmed_at IS NULL OR
      v_reg.club_id IS DISTINCT FROM v_rules.club_id OR
      v_reg.flight_club IS DISTINCT FROM v_rules.club_id OR
      v_reg.entry_player IS DISTINCT FROM v_reg.player_id OR
      v_reg.buy_in IS NULL OR v_reg.buy_in<=0 OR
      v_reg.platform_fixed_fee IS NULL OR v_reg.platform_fixed_fee<0 OR
      v_reg.total_pay IS NULL OR v_reg.total_pay<v_reg.buy_in OR
      (v_reg.price_snapshot IS NOT NULL AND
        (v_reg.price_snapshot->>'buy_in')::numeric IS DISTINCT FROM v_reg.buy_in OR
        (v_reg.price_snapshot->>'total_pay')::numeric IS DISTINCT FROM v_reg.total_pay OR
        (v_reg.price_snapshot->>'platform_fee')::numeric
          IS DISTINCT FROM v_reg.platform_fixed_fee OR
        (v_reg.price_snapshot->>'rake')::numeric IS NULL OR
        (v_reg.price_snapshot->>'service_fee')::numeric IS NULL OR
        (v_reg.price_snapshot->>'rake')::numeric<0 OR
        (v_reg.price_snapshot->>'service_fee')::numeric<0 OR
        (v_reg.price_snapshot->>'rake')::numeric IS DISTINCT FROM
          trunc((v_reg.price_snapshot->>'rake')::numeric) OR
        (v_reg.price_snapshot->>'service_fee')::numeric IS DISTINCT FROM
          trunc((v_reg.price_snapshot->>'service_fee')::numeric) OR
        v_reg.total_pay::numeric IS DISTINCT FROM
          (v_reg.price_snapshot->>'buy_in')::numeric+
          (v_reg.price_snapshot->>'rake')::numeric+
          (v_reg.price_snapshot->>'service_fee')::numeric+
          (v_reg.price_snapshot->>'platform_fee')::numeric) OR
      (SELECT count(*) FROM public.tournament_entries e
         WHERE e.registration_id=v_reg.id AND e.status<>'cancelled')<>1 THEN
     RAISE EXCEPTION 'multi_day_payout_source_inconsistent' USING ERRCODE='23514';
   END IF;
   SELECT count(*) INTO v_count FROM public.satellite_ticket_value_transfers x
     WHERE x.registration_id=v_reg.id;
   SELECT coalesce(sum(CASE WHEN m.direction='in' AND m.purpose='buyin'
      THEN m.applied_amount WHEN m.direction='out' AND m.purpose='refund'
      THEN -m.applied_amount ELSE 0 END),0) INTO v_ledger
     FROM public.cashier_buyin_movements m WHERE m.registration_id=v_reg.id;
   SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'id',m.id,'purpose',m.purpose,'direction',m.direction,
     'appliedVnd',m.applied_amount) ORDER BY m.id),'[]'::jsonb)
     INTO v_movement_rows FROM public.cashier_buyin_movements m
     WHERE m.registration_id=v_reg.id;
   IF v_count=1 THEN
     SELECT x.*,k.status ticket_status INTO v_transfer
       FROM public.satellite_ticket_value_transfers x
       JOIN public.satellite_tickets k ON k.id=x.ticket_id
       WHERE x.registration_id=v_reg.id;
     IF NOT FOUND OR v_transfer.ticket_status<>'redeemed' OR
        v_transfer.target_tournament_id IS DISTINCT FROM v_reg.tournament_id OR
        v_transfer.club_id IS DISTINCT FROM v_rules.club_id OR
        v_transfer.target_buy_in_vnd IS DISTINCT FROM v_reg.buy_in OR
        v_transfer.target_credit_vnd IS DISTINCT FROM v_reg.total_pay OR
        v_transfer.target_rake_vnd IS DISTINCT FROM
          (v_reg.price_snapshot->>'rake')::bigint OR
        v_transfer.target_service_fee_vnd IS DISTINCT FROM
          (v_reg.price_snapshot->>'service_fee')::bigint OR
        v_reg.platform_fixed_fee<>0 OR
        v_transfer.source_debit_vnd IS DISTINCT FROM v_transfer.target_credit_vnd OR
        v_reg.price_snapshot->>'tender' IS DISTINCT FROM 'satellite_ticket' OR v_ledger<>0 OR
        EXISTS(SELECT 1 FROM public.satellite_redemption_reversals z
          WHERE z.original_transfer_id=v_transfer.id) THEN
       RAISE EXCEPTION 'multi_day_payout_ticket_unreconciled' USING ERRCODE='23514';
     END IF;
     v_tender:='TICKET_TRANSFER'; v_transfer_id:=v_transfer.id;
     v_target_rake:=v_transfer.target_rake_vnd;
     v_target_service_fee:=v_transfer.target_service_fee_vnd;
     v_ticket_status:=v_transfer.ticket_status;
     v_transfer_pool:=v_transfer_pool+v_transfer.target_buy_in_vnd;
   ELSIF v_count=0 THEN
     IF v_reg.price_snapshot->>'tender'='satellite_ticket' OR
        (v_reg.price_snapshot IS NOT NULL AND v_ledger<>v_reg.total_pay) OR
        (v_reg.price_snapshot IS NULL AND v_ledger<>0) THEN
       RAISE EXCEPTION 'multi_day_payout_direct_unreconciled' USING ERRCODE='23514';
     END IF;
     v_tender:='CONFIRMED_DIRECT'; v_transfer_id:=NULL;
     v_target_rake:=NULL; v_target_service_fee:=NULL; v_ticket_status:=NULL;
     v_direct:=v_direct+v_reg.buy_in;
   ELSE
     RAISE EXCEPTION 'multi_day_payout_duplicate_transfer' USING ERRCODE='23514';
   END IF;
   v_fee:=v_fee+v_reg.total_pay-v_reg.buy_in;
   v_source:=v_source||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'registrationId',v_reg.id,'entryId',v_reg.entry_id,'flightId',v_reg.tournament_id,
     'playerId',v_reg.player_id,'tender',v_tender,'transferId',v_transfer_id,
     'ticketStatus',v_ticket_status,'targetRakeVnd',v_target_rake,
     'targetServiceFeeVnd',v_target_service_fee,
     'poolVnd',v_reg.buy_in,'feeVnd',v_reg.total_pay-v_reg.buy_in,
     'totalVnd',v_reg.total_pay,'ledgerNetVnd',v_ledger,
     'registrationStatus',v_reg.status,'confirmedAt',v_reg.confirmed_at,
     'priceSnapshot',v_reg.price_snapshot,
     'movementRows',v_movement_rows));
 END LOOP;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',o.id,'kind',o.kind,'amountVnd',o.amount_vnd,'evidenceRef',o.evidence_ref,
      'reversesId',o.reverses_id,'adjustsId',o.adjusts_id) ORDER BY o.created_at,o.id),'[]'::jsonb),
    coalesce(sum(CASE WHEN o.kind='REVERSAL' THEN -o.amount_vnd ELSE o.amount_vnd END),0)
 INTO v_overlay_rows,v_recorded_overlay
 FROM public.multi_day_overlay_funding_v1 o WHERE o.event_id=p_event_id;
 IF v_recorded_overlay<0 THEN
   RAISE EXCEPTION 'multi_day_payout_overlay_negative' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'playerId',p.player_id,'participationId',p.id,'sourceBags',p.source_bags,
    'seedRevision',s.seed_revision,'seedStack',s.seed_stack,'entryId',s.entry_id)
    ORDER BY p.player_id),'[]'::jsonb)
 INTO v_qualification_rows FROM public.multi_day_final_participations_v1 p
 LEFT JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
 WHERE p.event_id=p_event_id;
 IF EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p
   LEFT JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
   LEFT JOIN public.tournament_entries e ON e.id=s.entry_id
   WHERE p.event_id=p_event_id AND (s.entry_id IS NULL OR e.finished_place IS NULL
     OR e.player_id<>p.player_id OR e.tournament_id<>v_rules.final_tournament_id)) OR
   EXISTS(SELECT 1 FROM public.tournament_entries e
     WHERE e.tournament_id=v_rules.final_tournament_id AND e.finished_place IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 s
         WHERE s.entry_id=e.id)) THEN
   RAISE EXCEPTION 'multi_day_payout_results_not_ready' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_final_adjustments_v1 a
   JOIN public.multi_day_final_participations_v1 p ON p.id=a.participation_id
   WHERE p.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_payout_adjustment_pending' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'position',q.position,'amountVnd',q.amount) ORDER BY q.position),'[]'::jsonb)
 INTO v_prize_rows FROM private.multi_day_payout_prize_rows_v1(v_rules.final_tournament_id,p_proposed_rows) q
 WHERE q.tournament_id=v_rules.final_tournament_id;
 IF p_proposed_rows IS NULL THEN PERFORM private.multi_day_payout_validate_positions_v1(v_rules.final_tournament_id); END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',m.id,'playerId',m.recipient_ref,'amountVnd',m.prize_amount,'status',m.status)
    ORDER BY m.id),'[]'::jsonb)
 INTO v_payment_rows FROM public.tournament_prize_payments m
 WHERE m.tournament_id=v_rules.final_tournament_id;
 IF EXISTS(SELECT 1 FROM public.tournament_prize_payments m
    WHERE m.tournament_id=v_rules.final_tournament_id AND
      (m.status<>'paid' OR m.prize_amount<0 OR m.prize_amount<>trunc(m.prize_amount)
       OR m.recipient_ref IS NULL OR NOT EXISTS(
         SELECT 1 FROM public.multi_day_final_participations_v1 p
          WHERE p.event_id=p_event_id AND p.player_id=m.recipient_ref))) THEN
   RAISE EXCEPTION 'multi_day_payout_payment_unmatched' USING ERRCODE='23514';
 END IF;
 FOR v_group IN SELECT e.finished_place rank,count(*)::integer player_count
    FROM public.multi_day_final_participations_v1 p
    JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
    JOIN public.tournament_entries e ON e.id=s.entry_id
    WHERE p.event_id=p_event_id
    GROUP BY e.finished_place ORDER BY e.finished_place LOOP
   v_group_size:=v_group.player_count;
   IF v_group.rank<>v_next_rank OR v_group_size<1 THEN
     RAISE EXCEPTION 'multi_day_payout_rank_gap' USING ERRCODE='23514';
   END IF;
   IF v_next_rank<=v_itm_places AND
      v_next_rank+v_group_size-1>v_itm_places THEN
     RAISE EXCEPTION 'multi_day_payout_itm_boundary_tie' USING ERRCODE='23514';
   END IF;
   SELECT array_agg(coalesce(q.amount,0)::bigint ORDER BY rank_no),
     count(q.position) FILTER (WHERE rank_no<=v_itm_places)
     INTO v_rank_amounts,v_count
   FROM pg_catalog.generate_series(v_next_rank,v_next_rank+v_group_size-1) rank_no
   LEFT JOIN private.multi_day_payout_prize_rows_v1(v_rules.final_tournament_id,p_proposed_rows) q
     ON q.tournament_id=v_rules.final_tournament_id AND q.position=rank_no;
   v_required_positions:=greatest(least(v_next_rank+v_group_size-1,
     v_itm_places)-v_next_rank+1,0);
   IF v_count<>v_required_positions THEN
     RAISE EXCEPTION 'multi_day_payout_rank_amount_missing' USING ERRCODE='23514';
   END IF;
   IF v_group_size>1 THEN
     v_split:=public.multi_day_equal_tie_entitlement_v1(v_rank_amounts,v_group_size);
     v_per_player:=(v_split->>'perPlayerVnd')::bigint;
     v_group_remainder:=(v_split->>'clubRetainedRemainderVnd')::bigint;
     v_tie_remainder:=v_tie_remainder+v_group_remainder;
     v_tie_batches:=v_tie_batches||pg_catalog.jsonb_build_array(
       pg_catalog.jsonb_build_object('firstRank',v_next_rank,
       'occupiedRankAmountsVnd',v_rank_amounts,'playerCount',v_group_size,
       'perPlayerVnd',v_per_player,'clubRetainedRemainderVnd',v_group_remainder));
   ELSE v_per_player:=v_rank_amounts[1]; END IF;
   FOR v_player IN SELECT p.* FROM public.multi_day_final_participations_v1 p
     JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id
     JOIN public.tournament_entries e ON e.id=s.entry_id
     WHERE p.event_id=p_event_id AND e.finished_place=v_group.rank
     ORDER BY p.player_id LOOP
     SELECT coalesce(sum(m.amount_vnd),0) INTO v_min_cash
       FROM public.multi_day_nonselected_min_cash_v1 m
       WHERE m.participation_id=v_player.id AND m.status='PENDING_FUNDING';
     v_floor:=v_player.participation_floor_vnd;
     IF v_floor<>trunc(v_floor) OR v_min_cash<>trunc(v_min_cash) THEN
       RAISE EXCEPTION 'multi_day_payout_fractional_obligation' USING ERRCODE='23514';
     END IF;
     IF v_player.policy='SUM_STACKS' AND v_min_cash<>0 THEN
       RAISE EXCEPTION 'multi_day_payout_sum_stacks_extra_cash' USING ERRCODE='23514';
     END IF;
     v_obligation:=greatest(v_per_player::numeric,v_floor)+v_min_cash;
     SELECT coalesce(sum(m.prize_amount),0) INTO v_player_paid
       FROM public.tournament_prize_payments m
       WHERE m.tournament_id=v_rules.final_tournament_id
         AND m.recipient_ref=v_player.player_id AND m.status='paid';
     IF v_player_paid>v_obligation THEN
       RAISE EXCEPTION 'multi_day_payout_overpaid' USING ERRCODE='23514';
     END IF;
     v_paid:=v_paid+v_player_paid;
     v_unpaid:=v_unpaid+v_obligation-v_player_paid;
     v_obligations:=v_obligations||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
       'playerId',v_player.player_id,'participationId',v_player.id,'rank',v_group.rank,
       'rankAwardVnd',v_per_player,'participationFloorVnd',v_floor,
       'nonselectedBagMinCashVnd',v_min_cash,'totalVnd',v_obligation,
       'paidVnd',v_player_paid,'unpaidVnd',v_obligation-v_player_paid));
   END LOOP;
   v_next_rank:=v_next_rank+v_group_size;
 END LOOP;
 IF v_next_rank=1 THEN
   RAISE EXCEPTION 'multi_day_payout_no_results' USING ERRCODE='23514';
 END IF;
 -- A seeded historical row has identical economics and must retain its
 -- pre-migration rules revision; independently configured rows bind Day2.
 v_rules_version:=pg_catalog.md5((pg_catalog.jsonb_build_object(
   'policy',v_rules.policy,'itm',v_rules.itm_percent,
   'minCashX',v_rules.min_cash_x,'buyIn',v_rules.buy_in_vnd,
   'rake',v_rules.rake_vnd) || CASE
     WHEN v_rules.day2_percent=v_rules.itm_percent THEN '{}'::jsonb
     ELSE pg_catalog.jsonb_build_object('day2',v_rules.day2_percent)
   END)::text);
 v_funding_revision:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'sources',v_source,'overlay',v_overlay_rows)::text);
 v_qualification_revision:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'sourceHash',v_lock.source_hash,'selectionHash',v_lock.selection_hash,
   'participants',v_qualification_rows)::text);
 v_input_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'rules',v_rules_version,'funding',v_funding_revision,
   'qualification',v_qualification_revision,'prizes',v_prize_rows,
   'payments',v_payment_rows,'obligations',v_obligations,
   'tieBatches',v_tie_batches)::text);
 v_required:=greatest(v_paid+v_unpaid+v_tie_remainder-
   v_direct-v_transfer_pool-v_recorded_overlay,0);
 v_unallocated:=greatest(v_direct+v_transfer_pool+v_recorded_overlay-
   v_paid-v_unpaid-v_tie_remainder,0);
 IF greatest(v_direct,v_transfer_pool,v_fee,v_recorded_overlay,v_paid,v_unpaid,
     v_tie_remainder,v_required,v_unallocated)>9007199254740991 THEN
   RAISE EXCEPTION 'multi_day_payout_amount_overflow' USING ERRCODE='22003';
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'eventId',p_event_id,
   'finalTournamentId',v_rules.final_tournament_id,
   'itmPercent',v_rules.itm_percent,'day2Percent',v_rules.day2_percent,
   'itmPlaces',v_itm_places,
   'state',CASE WHEN v_required>0 THEN 'REQUIRED_SHORTFALL' ELSE 'READY' END,
   'rulesVersion',v_rules_version,'fundingRevision',v_funding_revision,
   'qualificationRevision',v_qualification_revision,'payoutInputHash',v_input_hash,
   'directPoolVnd',v_direct::bigint,'transferPoolVnd',v_transfer_pool::bigint,
   'feesVnd',v_fee::bigint,'recordedOverlayVnd',v_recorded_overlay::bigint,
   'requiredShortfallVnd',v_required::bigint,'paidPlayerVnd',v_paid::bigint,
   'unpaidObligationVnd',v_unpaid::bigint,
   'clubRetainedTieVnd',v_tie_remainder::bigint,
   'unallocatedPoolVnd',v_unallocated::bigint,
   'obligations',v_obligations,'tieBatches',v_tie_batches,
   'sourceSnapshot',pg_catalog.jsonb_build_object(
     'registrations',v_source,'overlayRecords',v_overlay_rows,
     'prizePositions',v_prize_rows,'payments',v_payment_rows));
END $function$
;
DROP FUNCTION private.multi_day_individual_obligation_quote_v1(uuid);
DROP FUNCTION private.multi_day_obligation_amount_v1(numeric,numeric,numeric);
