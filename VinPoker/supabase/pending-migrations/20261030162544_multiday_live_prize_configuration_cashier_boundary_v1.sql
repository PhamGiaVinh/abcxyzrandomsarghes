-- LOCAL pending forward correction; after complete Early ITM package plus ranking296.
-- Allows canonical planned prize configuration during active Final; never finalizes obligations/payments.
-- Freeze configuration once any individual obligation exists. Existing finalized/paid guards retained.
-- Payment-private bank wrapper accepts only existing owner/cashier; public Floor funding is unchanged.
-- Rollback: stop affected local UI, restore definition rows from private.multiday_live_prize_pre_20261030, then remove only new helper/backup after verifying no references; preserve financial history.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$ BEGIN
 ASSERT current_user='postgres';ASSERT to_regclass('private.multiday_live_prize_pre_20261030') IS NULL,'live_prize_backup_collision';ASSERT to_regprocedure('private.multi_day_live_prize_source_v1(uuid,jsonb)') IS NULL,'live_prize_helper_collision';ASSERT to_regprocedure('private.multi_day_live_prize_budget_v1(uuid,jsonb)') IS NULL,'live_prize_budget_collision';
ASSERT md5(replace(pg_get_functiondef('private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure),chr(13),''))='55dfcd5f4e3d49924e5265218fab33a9','live_prize_dependency_drift: private.multi_day_funding_evaluate_v1(uuid,jsonb)';ASSERT (SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}' FROM pg_proc WHERE oid='private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure),'live_prize_authority_drift';
ASSERT md5(replace(pg_get_functiondef('public.multi_day_payout_configuration_preview_v1(uuid,jsonb)'::regprocedure),chr(13),''))='17d825c5a43605ae8029b50ea6071886','live_prize_dependency_drift: public.multi_day_payout_configuration_preview_v1(uuid,jsonb)';ASSERT (SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres,authenticated=X/postgres}' FROM pg_proc WHERE oid='public.multi_day_payout_configuration_preview_v1(uuid,jsonb)'::regprocedure),'live_prize_authority_drift';
ASSERT md5(replace(pg_get_functiondef('public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)'::regprocedure),chr(13),''))='fea9b4dbed3bb972f06b9bfa6132f55b','live_prize_dependency_drift: public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)';ASSERT (SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres,authenticated=X/postgres}' FROM pg_proc WHERE oid='public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)'::regprocedure),'live_prize_authority_drift';
ASSERT md5(replace(pg_get_functiondef('private.multi_day_payment_verified_funding_v1(uuid)'::regprocedure),chr(13),''))='838208da3d894621915fe62b287e0465','live_prize_dependency_drift: private.multi_day_payment_verified_funding_v1(uuid)';ASSERT (SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}' FROM pg_proc WHERE oid='private.multi_day_payment_verified_funding_v1(uuid)'::regprocedure),'live_prize_authority_drift';
END $guard$;
CREATE TABLE private.multiday_live_prize_pre_20261030(signature text PRIMARY KEY,definition text NOT NULL,metadata jsonb NOT NULL);
ALTER TABLE private.multiday_live_prize_pre_20261030 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multiday_live_prize_pre_20261030 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.multiday_live_prize_pre_20261030 SELECT 'public.multi_day_payout_configuration_preview_v1(uuid,jsonb)',pg_get_functiondef('public.multi_day_payout_configuration_preview_v1(uuid,jsonb)'::regprocedure),(SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,'names',proargnames,'args',proargtypes::text,'defaults',pronargdefaults,'result',prorettype::text) FROM pg_proc WHERE oid='public.multi_day_payout_configuration_preview_v1(uuid,jsonb)'::regprocedure);
INSERT INTO private.multiday_live_prize_pre_20261030 SELECT 'public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)',pg_get_functiondef('public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)'::regprocedure),(SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,'names',proargnames,'args',proargtypes::text,'defaults',pronargdefaults,'result',prorettype::text) FROM pg_proc WHERE oid='public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)'::regprocedure);
INSERT INTO private.multiday_live_prize_pre_20261030 SELECT 'private.multi_day_payment_verified_funding_v1(uuid)',pg_get_functiondef('private.multi_day_payment_verified_funding_v1(uuid)'::regprocedure),(SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,'names',proargnames,'args',proargtypes::text,'defaults',pronargdefaults,'result',prorettype::text) FROM pg_proc WHERE oid='private.multi_day_payment_verified_funding_v1(uuid)'::regprocedure);
CREATE OR REPLACE FUNCTION private.multi_day_live_prize_source_v1(p_event_id uuid, p_proposed_rows jsonb)
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
   WHERE p.event_id=p_event_id AND (s.entry_id IS NULL OR e.id IS NULL
     OR e.player_id<>p.player_id OR e.tournament_id<>v_rules.final_tournament_id)) OR
   EXISTS(SELECT 1 FROM public.tournament_entries e
     WHERE e.tournament_id=v_rules.final_tournament_id
       AND NOT EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 s
         WHERE s.entry_id=e.id)) THEN
   RAISE EXCEPTION 'multi_day_funding_participation_identity_invalid' USING ERRCODE='23514';
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

 IF p_proposed_rows IS NULL THEN RAISE EXCEPTION 'multi_day_payout_proposal_required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM generate_series(1,v_itm_places)n LEFT JOIN private.multi_day_payout_prize_rows_v1(v_rules.final_tournament_id,p_proposed_rows) q ON q.position=n GROUP BY n HAVING count(q.position)<>1 OR count(q.amount)<>1)
 THEN RAISE EXCEPTION 'multi_day_payout_rank_amount_missing' USING ERRCODE='23514';END IF;
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

REVOKE ALL ON FUNCTION private.multi_day_live_prize_source_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.multi_day_live_prize_budget_v1(p_event_id uuid,p_funding jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $budget$
DECLARE base jsonb;planned numeric;extra numeric;funded numeric;result jsonb;
BEGIN
 base:=private.multi_day_individual_obligation_budget_v1(p_event_id,p_funding);
 SELECT sum(private.multi_day_obligation_amount_v1(coalesce((q.value->>'amountVnd')::numeric,0),(base->>'eventFloorVnd')::numeric,0)) INTO planned
 FROM generate_series(1,(base->>'field')::integer)n LEFT JOIN jsonb_array_elements(p_funding->'prizePositions')q(value) ON (q.value->>'position')::integer=n;
 SELECT coalesce(sum((x->>'amountVnd')::numeric),0) INTO extra FROM jsonb_array_elements(base->'nonselectedMinCash')x;
 planned:=planned+extra;funded:=(base->>'fundedVnd')::numeric;
 IF planned IS NULL OR planned<0 OR planned>9007199254740991 THEN RAISE EXCEPTION 'live_prize_budget_amount_invalid' USING ERRCODE='22003';END IF;
 result:=(base-'budgetHash')||jsonb_build_object('requiredTotalVnd',planned::bigint,'requiredShortfallVnd',greatest(planned-funded,0)::bigint);
 RETURN result||jsonb_build_object('budgetHash',md5(result::text));
END $budget$;
REVOKE ALL ON FUNCTION private.multi_day_live_prize_budget_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.multi_day_payout_configuration_preview_v1(p_event_id uuid, p_proposed_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb; v_club uuid; v_banks jsonb; v_funding text; v_hash text;
BEGIN
 SELECT e.club_id INTO v_club FROM public.tournament_events e WHERE e.id=p_event_id;
 IF auth.uid() IS NULL OR v_club IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.clubs c WHERE c.id=v_club AND
     (c.owner_id=auth.uid() OR public.is_club_floor(auth.uid(),v_club))) THEN
   RAISE EXCEPTION 'multi_day_payout_actor_or_qualification_denied'
     USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
     WHERE g.id AND g.enabled AND v_club=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 -- Check exact movement identity before the old source classifier runs.
 IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
   LEFT JOIN public.tournament_registrations r ON r.id=m.registration_id
   LEFT JOIN public.tournaments rt ON rt.id=r.tournament_id
   LEFT JOIN public.tournaments mt ON mt.id=m.tournament_id
   WHERE (rt.event_id=p_event_id OR mt.event_id=p_event_id) AND
     (r.id IS NULL OR m.tournament_id IS DISTINCT FROM r.tournament_id OR
      m.club_id IS DISTINCT FROM r.club_id OR m.club_id IS DISTINCT FROM v_club)) THEN
   RAISE EXCEPTION 'multi_day_payout_source_unmatched' USING ERRCODE='23514';
 END IF;
 -- Confirmed legacy state is not funding. Until a canonical historical
 -- money proof is represented in the source contract, NULL snapshot is held.
 IF EXISTS(SELECT 1 FROM public.tournament_registrations r
   JOIN public.tournaments t ON t.id=r.tournament_id
   WHERE t.event_id=p_event_id AND t.phase='flight' AND
     r.status='confirmed' AND r.price_snapshot IS NULL) THEN
   RAISE EXCEPTION 'multi_day_payout_legacy_funding_unverified'
     USING ERRCODE='23514';
 END IF;
 IF p_proposed_rows IS NULL THEN RAISE EXCEPTION 'multi_day_payout_proposal_required' USING ERRCODE='22023'; END IF; IF EXISTS(SELECT 1 FROM public.tournament_events e JOIN public.tournaments t ON t.id=e.final_tournament_id AND t.event_id=e.id AND t.club_id=e.club_id WHERE e.id=p_event_id AND t.phase='final' AND t.status IN ('active','live','break','final_table')) THEN
 v_result:=private.multi_day_live_prize_source_v1(p_event_id,p_proposed_rows);
 v_result:=v_result||jsonb_build_object('planningBudget',private.multi_day_live_prize_budget_v1(p_event_id,v_result));
 v_result:=v_result||jsonb_build_object('state','LIVE_PRIZE_CONFIGURATION_PROPOSAL','payoutInputHash',v_result->>'sourceInputHash','requiredShortfallVnd',(v_result->'planningBudget'->>'requiredShortfallVnd')::bigint,'planningOnly',true);
 ELSE v_result:=private.multi_day_payout_evaluate_v2(p_event_id,p_proposed_rows);END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 o
   LEFT JOIN public.bank_transactions b ON b.id=o.bank_transaction_id
   WHERE o.event_id=p_event_id AND o.kind IN('RECORDED','ADJUSTMENT') AND
     (b.id IS NULL OR b.club_id IS DISTINCT FROM o.club_id OR
      b.provider IS DISTINCT FROM 'sepay' OR b.api_verified_at IS NULL OR
      b.transfer_type IS DISTINCT FROM 'in' OR b.status IS DISTINCT FROM 'matched' OR
      b.amount IS NULL OR b.amount<o.amount_vnd OR
      EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
        WHERE m.bank_transaction_id=b.id) OR
      EXISTS(SELECT 1 FROM public.payment_settlements s
        WHERE s.bank_transaction_id=b.id))) THEN
   RAISE EXCEPTION 'multi_day_payout_overlay_unverified' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'overlayId',o.id,'bankTransactionId',b.id,'bankAmountVnd',b.amount,
   'provider',b.provider,'apiVerifiedAt',b.api_verified_at,
   'transferType',b.transfer_type,'status',b.status,'clubId',b.club_id)
   ORDER BY o.id),'[]'::jsonb) INTO v_banks
 FROM public.multi_day_overlay_funding_v1 o
 JOIN public.bank_transactions b ON b.id=o.bank_transaction_id
 WHERE o.event_id=p_event_id AND o.kind IN('RECORDED','ADJUSTMENT');
 v_funding:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'priorFunding',v_result->>'fundingRevision','bankProof',v_banks)::text);
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'priorInput',v_result->>'payoutInputHash','funding',v_funding)::text);
 RETURN pg_catalog.jsonb_build_object('previewOnly',true,'configurationPersistence','NOT_PERFORMED','paymentExecution','NOT_PERFORMED', 'configurationRevision',(SELECT pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.position,q.id),'[]'::jsonb)::text) FROM public.tournament_prizes q WHERE q.tournament_id=(v_result->>'finalTournamentId')::uuid))||pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.jsonb_set(
   v_result,'{fundingRevision}',pg_catalog.to_jsonb(v_funding)),
   '{payoutInputHash}',pg_catalog.to_jsonb(v_hash)),
   '{sourceSnapshot,bankProof}',v_banks,true);
END $function$;

CREATE OR REPLACE FUNCTION public.multi_day_save_prize_configuration_v1(p_event_id uuid, p_rows jsonb, p_expected_configuration_revision text, p_expected_rules_version text, p_expected_funding_revision text, p_expected_qualification_revision text, p_expected_payout_input_hash text, p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); event public.tournament_events%ROWTYPE;
 final public.tournaments%ROWTYPE; prior private.multi_day_prize_configurations_v1%ROWTYPE;
 canonical jsonb; request_payload jsonb; request_hash text; before_rows jsonb; after_rows jsonb; preview jsonb; receipt jsonb;
 row public.tournament_prizes%ROWTYPE; proposed record; total numeric; row_count integer; expected_final uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'multi_day_configuration_actor_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO event FROM public.tournament_events WHERE id=p_event_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=event.club_id AND c.owner_id=actor) THEN
   RAISE EXCEPTION 'multi_day_configuration_actor_denied' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason))=0
   OR p_expected_configuration_revision IS NULL OR p_expected_configuration_revision !~ '^[0-9a-f]{32}$'
   OR p_expected_rules_version IS NULL OR p_expected_rules_version !~ '^[0-9a-f]{32}$'
   OR p_expected_funding_revision IS NULL OR p_expected_funding_revision !~ '^[0-9a-f]{32}$'
   OR p_expected_qualification_revision IS NULL OR p_expected_qualification_revision !~ '^[0-9a-f]{32}$'
   OR p_expected_payout_input_hash IS NULL OR p_expected_payout_input_hash !~ '^[0-9a-f]{32}$'
   OR p_rows IS NULL THEN RAISE EXCEPTION 'multi_day_configuration_invalid_request' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(jsonb_build_object('position',q.position,'amount',q.amount) ORDER BY q.position),count(*),sum(q.amount)
 INTO canonical,row_count,total FROM private.multi_day_payout_prize_rows_v1(event.final_tournament_id,p_rows) q;
 IF row_count=0 OR EXISTS(SELECT 1 FROM(
   SELECT q.position,q.amount,row_number() OVER(ORDER BY q.position) n,lag(q.amount) OVER(ORDER BY q.position) previous
   FROM private.multi_day_payout_prize_rows_v1(event.final_tournament_id,p_rows) q) x
   WHERE x.position<>x.n OR x.amount>9999999999.99 OR x.amount>x.previous) THEN
   RAISE EXCEPTION 'multi_day_configuration_rows_invalid' USING ERRCODE='23514';
 END IF;
 request_payload:=jsonb_build_object('event',p_event_id,'rows',canonical,'configuration',p_expected_configuration_revision,
  'rules',p_expected_rules_version,'funding',p_expected_funding_revision,'qualification',p_expected_qualification_revision,
  'proposal',p_expected_payout_input_hash,'reason',btrim(p_reason));
 request_hash:=md5(request_payload::text);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.multi_day_prize_configurations_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.request_hash<>request_hash THEN RAISE EXCEPTION 'multi_day_configuration_idempotency_conflict' USING ERRCODE='23505';END IF;
   RETURN prior.receipt||jsonb_build_object('idempotent',true);
 END IF;
 -- Match the old tournament-first writer without blocking Finalize's FK KEY SHARE.
 expected_final:=event.final_tournament_id;
 SELECT * INTO final FROM public.tournaments WHERE id=expected_final FOR NO KEY UPDATE;
 SELECT * INTO event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF final.id IS NULL OR final.id IS DISTINCT FROM event.final_tournament_id OR final.event_id IS DISTINCT FROM p_event_id
  OR final.club_id IS DISTINCT FROM event.club_id OR final.phase IS DISTINCT FROM 'final' OR final.status NOT IN ('active','live','break','final_table','completed')
  OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=event.club_id AND c.owner_id=actor) THEN
   RAISE EXCEPTION 'multi_day_configuration_source_changed' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=p_event_id)
  OR EXISTS(SELECT 1 FROM public.tournament_prize_payments m WHERE m.tournament_id=final.id)
  OR EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 o WHERE o.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_configuration_already_finalized_or_paid' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.position,q.id),'[]'::jsonb) INTO before_rows
 FROM public.tournament_prizes q WHERE q.tournament_id=final.id;
 IF md5(before_rows::text)<>p_expected_configuration_revision THEN
   RAISE EXCEPTION 'multi_day_configuration_stale' USING ERRCODE='40001';END IF;
 preview:=public.multi_day_payout_configuration_preview_v1(p_event_id,canonical);
 IF (preview->>'itmPlaces')::integer<>row_count OR preview->>'rulesVersion'<>p_expected_rules_version
  OR preview->>'fundingRevision'<>p_expected_funding_revision OR preview->>'qualificationRevision'<>p_expected_qualification_revision
  OR preview->>'payoutInputHash'<>p_expected_payout_input_hash THEN
   RAISE EXCEPTION 'multi_day_configuration_source_changed' USING ERRCODE='40001';END IF;
 FOR row IN SELECT * FROM public.tournament_prizes q WHERE q.tournament_id=final.id ORDER BY q.position,q.id LOOP
   INSERT INTO private.multi_day_prize_write_intents_v1 VALUES(txid_current(),pg_backend_pid(),actor,'DELETE',row.id,to_jsonb(row));
   DELETE FROM public.tournament_prizes WHERE id=row.id;
 END LOOP;
 FOR proposed IN SELECT * FROM private.multi_day_payout_prize_rows_v1(final.id,canonical) ORDER BY "position" LOOP
   row.id:=gen_random_uuid();row.tournament_id:=final.id;row.position:=proposed.position;
   row.amount:=proposed.amount;row.percentage:=CASE WHEN total=0 THEN 0 ELSE round(proposed.amount/total*100,2) END;
   row.created_at:=clock_timestamp();
   INSERT INTO private.multi_day_prize_write_intents_v1 VALUES(txid_current(),pg_backend_pid(),actor,'INSERT',row.id,to_jsonb(row));
   INSERT INTO public.tournament_prizes SELECT (row).*;
 END LOOP;
 IF EXISTS(SELECT 1 FROM private.multi_day_prize_write_intents_v1 i WHERE i.transaction_id=txid_current() AND i.backend_pid=pg_backend_pid() AND i.actor_id=actor) THEN
   RAISE EXCEPTION 'multi_day_configuration_intent_not_consumed' USING ERRCODE='23514';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.position,q.id),'[]'::jsonb) INTO after_rows
 FROM public.tournament_prizes q WHERE q.tournament_id=final.id;
 receipt:=jsonb_build_object('ok',true,'idempotent',false,'state','CONFIGURED','eventId',p_event_id,'requestId',p_request_id,
   'configurationRevision',md5(after_rows::text),'previousConfigurationRevision',p_expected_configuration_revision,
   'payoutInputHash',p_expected_payout_input_hash,'requestPayload',request_payload,'requiredShortfallVnd',preview->'requiredShortfallVnd',
   'paymentExecution','NOT_PERFORMED','fundingExecution','NOT_PERFORMED','obligationFinalization','NOT_PERFORMED');
 INSERT INTO private.multi_day_prize_configurations_v1(actor_id,request_id,event_id,tournament_id,request_hash,previous_rows,new_rows,receipt)
 VALUES(actor,p_request_id,p_event_id,final.id,request_hash,before_rows,after_rows,receipt);
 RETURN receipt;
END $function$;

CREATE OR REPLACE FUNCTION private.multi_day_payment_verified_funding_v1(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb; v_club uuid; v_banks jsonb; v_funding text; v_hash text;
BEGIN
 SELECT e.club_id INTO v_club FROM public.tournament_events e WHERE e.id=p_event_id;
 IF auth.uid() IS NULL OR v_club IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.clubs c WHERE c.id=v_club AND
     (c.owner_id=auth.uid() OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=v_club AND cc.user_id=auth.uid()))) THEN
   RAISE EXCEPTION 'multi_day_payout_actor_or_qualification_denied'
     USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
     WHERE g.id AND g.enabled AND v_club=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 -- Check exact movement identity before the old source classifier runs.
 IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
   LEFT JOIN public.tournament_registrations r ON r.id=m.registration_id
   LEFT JOIN public.tournaments rt ON rt.id=r.tournament_id
   LEFT JOIN public.tournaments mt ON mt.id=m.tournament_id
   WHERE (rt.event_id=p_event_id OR mt.event_id=p_event_id) AND
     (r.id IS NULL OR m.tournament_id IS DISTINCT FROM r.tournament_id OR
      m.club_id IS DISTINCT FROM r.club_id OR m.club_id IS DISTINCT FROM v_club)) THEN
   RAISE EXCEPTION 'multi_day_payout_source_unmatched' USING ERRCODE='23514';
 END IF;
 -- Confirmed legacy state is not funding. Until a canonical historical
 -- money proof is represented in the source contract, NULL snapshot is held.
 IF EXISTS(SELECT 1 FROM public.tournament_registrations r
   JOIN public.tournaments t ON t.id=r.tournament_id
   WHERE t.event_id=p_event_id AND t.phase='flight' AND
     r.status='confirmed' AND r.price_snapshot IS NULL) THEN
   RAISE EXCEPTION 'multi_day_payout_legacy_funding_unverified'
     USING ERRCODE='23514';
 END IF;
 v_result:=private.multi_day_payment_funding_evaluate_v1(p_event_id,NULL);
 IF EXISTS(SELECT 1 FROM public.multi_day_overlay_funding_v1 o
   LEFT JOIN public.bank_transactions b ON b.id=o.bank_transaction_id
   WHERE o.event_id=p_event_id AND o.kind IN('RECORDED','ADJUSTMENT') AND
     (b.id IS NULL OR b.club_id IS DISTINCT FROM o.club_id OR
      b.provider IS DISTINCT FROM 'sepay' OR b.api_verified_at IS NULL OR
      b.transfer_type IS DISTINCT FROM 'in' OR b.status IS DISTINCT FROM 'matched' OR
      b.amount IS NULL OR b.amount<o.amount_vnd OR
      EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
        WHERE m.bank_transaction_id=b.id) OR
      EXISTS(SELECT 1 FROM public.payment_settlements s
        WHERE s.bank_transaction_id=b.id))) THEN
   RAISE EXCEPTION 'multi_day_payout_overlay_unverified' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'overlayId',o.id,'bankTransactionId',b.id,'bankAmountVnd',b.amount,
   'provider',b.provider,'apiVerifiedAt',b.api_verified_at,
   'transferType',b.transfer_type,'status',b.status,'clubId',b.club_id)
   ORDER BY o.id),'[]'::jsonb) INTO v_banks
 FROM public.multi_day_overlay_funding_v1 o
 JOIN public.bank_transactions b ON b.id=o.bank_transaction_id
 WHERE o.event_id=p_event_id AND o.kind IN('RECORDED','ADJUSTMENT');
 v_funding:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'priorFunding',v_result->>'fundingRevision','bankProof',v_banks)::text);
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'priorInput',v_result->>'sourceInputHash','funding',v_funding)::text);
 RETURN pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.jsonb_set(
   v_result,'{fundingRevision}',pg_catalog.to_jsonb(v_funding)),
   '{sourceInputHash}',pg_catalog.to_jsonb(v_hash)),
   '{sourceSnapshot,bankProof}',v_banks,true);
END $function$;

DO $post$ DECLARE saved record;actual jsonb;BEGIN
 FOR saved IN SELECT * FROM private.multiday_live_prize_pre_20261030 LOOP actual:=(SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,'names',proargnames,'args',proargtypes::text,'defaults',pronargdefaults,'result',prorettype::text) FROM pg_proc WHERE oid=saved.signature::regprocedure);ASSERT actual=saved.metadata,'live_prize_existing_authority_changed';END LOOP;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure)='7ecfb3f082c03267ed728e9cb0648583','public_floor_funding_source_changed';
 ASSERT NOT has_function_privilege('authenticated','private.multi_day_live_prize_source_v1(uuid,jsonb)','EXECUTE');ASSERT NOT has_function_privilege('anon','private.multi_day_live_prize_source_v1(uuid,jsonb)','EXECUTE');ASSERT NOT has_function_privilege('service_role','private.multi_day_live_prize_source_v1(uuid,jsonb)','EXECUTE');
END $post$;
COMMIT;
