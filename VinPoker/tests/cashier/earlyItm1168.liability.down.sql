-- Exact code inverse only while no individual/global-link history exists.
-- Retained debt requires forward repair preserving visibility and audit.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1) OR EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE source_snapshot ? 'individualObligations') THEN RAISE EXCEPTION 'individual_global_liability_history_retained_use_forward_repair';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_unified_obligation_accounting_v1(uuid)'::regprocedure) IS DISTINCT FROM '1c6d399ff2023e862fa3ca794cc87be9' THEN RAISE EXCEPTION 'individual_global_liability_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.multi_day_finalize_payout_v1(uuid,text,text,text,text,uuid)'::regprocedure) IS DISTINCT FROM '205db04143f02f693760eaa07c2ccb25' THEN RAISE EXCEPTION 'individual_global_liability_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.reconcile_multi_day_individual_obligations_v1(uuid,jsonb)'::regprocedure) IS DISTINCT FROM 'eb4a55506cd546eb9d88e5aa20ead840' THEN RAISE EXCEPTION 'individual_global_liability_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_club_payout_liability(timestamp with time zone,timestamp with time zone,uuid)'::regprocedure) IS DISTINCT FROM 'c97d3699855f8e6e4f46f3456cd50719' THEN RAISE EXCEPTION 'individual_global_liability_down_body_drift';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_club_payout_liability(p_from timestamp with time zone, p_to timestamp with time zone, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_super boolean := false;
  v_all_ids uuid[];
  v_club_ids uuid[];
  v_per jsonb;
  v_owed numeric := 0;
  v_paid numeric := 0;
  v_out numeric := 0;
  v_aging jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'super_admin'
  ) INTO v_super;

  IF v_super THEN
    SELECT COALESCE(array_agg(id), '{}') INTO v_all_ids FROM public.clubs;
  ELSE
    SELECT COALESCE(array_agg(id), '{}') INTO v_all_ids FROM public.clubs WHERE owner_id = v_uid;
  END IF;

  IF p_club_id IS NOT NULL THEN
    IF NOT (p_club_id = ANY(v_all_ids)) THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;
    v_club_ids := ARRAY[p_club_id];
  ELSE
    v_club_ids := v_all_ids;
  END IF;

  IF v_all_ids IS NULL OR array_length(v_all_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'periodFrom', p_from, 'periodTo', p_to,
      'owedTotal', 0, 'paidTotal', 0, 'outstandingTotal', 0,
      'perTournament', '[]'::jsonb,
      'aging', jsonb_build_object('d0_1', 0, 'd2_7', 0, 'd8p', 0)
    );
  END IF;

  -- Per-tournament liability. Close date = close-report else start_time (NEVER reg-close).
  WITH scoped AS (
    SELECT
      t.id,
      t.name,
      COALESCE(cr.closed_at, t.start_time) AS close_date,
      (cr.tournament_id IS NOT NULL)       AS is_closed,
      CASE WHEN t.phase='final' AND EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 q WHERE q.event_id=t.event_id)
       THEN EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=t.event_id AND f.final_tournament_id=t.id)
       ELSE EXISTS(SELECT 1 FROM public.tournament_entries e WHERE e.tournament_id=t.id AND e.finished_place IS NOT NULL) END AS has_finished_place
    FROM public.tournaments t
    LEFT JOIN public.tournament_close_report cr ON cr.tournament_id = t.id
    WHERE t.club_id = ANY(v_club_ids)
      AND COALESCE(cr.closed_at, t.start_time) >= p_from
      AND COALESCE(cr.closed_at, t.start_time) <= p_to
  ),
  calc AS (
    SELECT
      s.id, s.name, s.close_date, s.is_closed, s.has_finished_place,
      CASE WHEN f.event_id IS NOT NULL THEN
       (d.state->>'paidPlayerVnd')::numeric+(d.state->>'unpaidObligationVnd')::numeric
       WHEN s.has_finished_place THEN (
        SELECT COALESCE(SUM(
          (SELECT tp.amount FROM public.tournament_prizes tp
           WHERE tp.tournament_id = e.tournament_id AND tp.position = e.finished_place)
        ), 0)
        FROM public.tournament_entries e
        WHERE e.tournament_id = s.id AND e.finished_place IS NOT NULL
      ) ELSE NULL END AS owed,
      CASE WHEN f.event_id IS NOT NULL THEN (d.state->>'paidPlayerVnd')::numeric ELSE
       (SELECT COALESCE(SUM(pp.prize_amount),0) FROM public.tournament_prize_payments pp
        WHERE pp.tournament_id=s.id AND pp.status='paid') END AS paid,
      (SELECT COUNT(*) FROM public.tournament_entries e
       WHERE e.tournament_id = s.id AND e.finished_place IS NOT NULL) AS finishers_count
    FROM scoped s
    LEFT JOIN public.multi_day_payout_finalizations_v1 f ON f.final_tournament_id=s.id
     AND f.event_id=(SELECT t.event_id FROM public.tournaments t WHERE t.id=s.id)
    LEFT JOIN LATERAL (SELECT CASE WHEN f.event_id IS NOT NULL THEN private.multi_day_payout_accounting_v1(f.event_id) ELSE NULL END AS state) d ON true
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'tournamentId', c.id, 'name', c.name, 'closeDate', c.close_date,
      'isClosed', c.is_closed, 'hasFinishedPlace', c.has_finished_place,
      'owed', c.owed, 'paid', c.paid,
      'outstanding', CASE WHEN c.owed IS NULL THEN NULL ELSE c.owed - c.paid END,
      'finishersCount', c.finishers_count
    ) ORDER BY c.close_date DESC), '[]'::jsonb),
    COALESCE(SUM(c.owed), 0),
    COALESCE(SUM(c.paid) FILTER (WHERE c.owed IS NOT NULL), 0),
    -- aging of OUTSTANDING (owed − paid) by close date, only for finalized tournaments
    jsonb_build_object(
      'd0_1', COALESCE(SUM(GREATEST(c.owed - c.paid, 0)) FILTER (
                 WHERE c.owed IS NOT NULL AND c.close_date >= now() - interval '1 day'), 0),
      'd2_7', COALESCE(SUM(GREATEST(c.owed - c.paid, 0)) FILTER (
                 WHERE c.owed IS NOT NULL AND c.close_date <  now() - interval '1 day'
                   AND c.close_date >= now() - interval '7 day'), 0),
      'd8p',  COALESCE(SUM(GREATEST(c.owed - c.paid, 0)) FILTER (
                 WHERE c.owed IS NOT NULL AND c.close_date <  now() - interval '7 day'), 0)
    )
  INTO v_per, v_owed, v_paid, v_aging
  FROM calc c;

  v_out := v_owed - v_paid;

  RETURN jsonb_build_object(
    'periodFrom', p_from, 'periodTo', p_to,
    'owedTotal', v_owed, 'paidTotal', v_paid, 'outstandingTotal', v_out,
    'perTournament', v_per, 'aging', v_aging
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.multi_day_finalize_payout_v1(p_event_id uuid, p_expected_rules_version text, p_expected_funding_revision text, p_expected_qualification_revision text, p_expected_payout_input_hash text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_prior public.multi_day_payout_finalizations_v1%ROWTYPE;
 v_preview jsonb; v_hash text; v_receipt jsonb;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL OR
    p_expected_rules_version IS NULL OR p_expected_funding_revision IS NULL OR
    p_expected_qualification_revision IS NULL OR p_expected_payout_input_hash IS NULL OR
    p_expected_rules_version !~ '^[0-9a-f]{32}$' OR
    p_expected_funding_revision !~ '^[0-9a-f]{32}$' OR
    p_expected_qualification_revision !~ '^[0-9a-f]{32}$' OR
    p_expected_payout_input_hash !~ '^[0-9a-f]{32}$' THEN
   RAISE EXCEPTION 'multi_day_payout_finalize_invalid' USING ERRCODE='22023';
 END IF;
 -- Common event fence is first. Writers take event SHARE at their existing
 -- entry/registration/movement seam; no registration or tournament row is
 -- locked here, so Cashier reg-first cannot cycle against this operation.
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clubs c
    WHERE c.id=v_event.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_payout_owner_required' USING ERRCODE='42501';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('event',p_event_id,
   'rules',p_expected_rules_version,'funding',p_expected_funding_revision,
   'qualification',p_expected_qualification_revision,
   'input',p_expected_payout_input_hash)::text);
 SELECT * INTO v_prior FROM public.multi_day_payout_finalizations_v1
    WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.event_id IS DISTINCT FROM p_event_id OR
      v_prior.actor_id IS DISTINCT FROM v_actor OR v_prior.request_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_payout_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt||pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f
    WHERE f.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_payout_already_finalized' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 BEGIN
   v_preview:=public.multi_day_payout_preview_v1(p_event_id);
 EXCEPTION WHEN check_violation THEN
   RAISE EXCEPTION 'multi_day_payout_recalculate' USING ERRCODE='40001';
 END;
 IF v_preview->>'rulesVersion' IS DISTINCT FROM p_expected_rules_version OR
    v_preview->>'fundingRevision' IS DISTINCT FROM p_expected_funding_revision OR
    v_preview->>'qualificationRevision' IS DISTINCT FROM p_expected_qualification_revision OR
    v_preview->>'payoutInputHash' IS DISTINCT FROM p_expected_payout_input_hash THEN
   RAISE EXCEPTION 'multi_day_payout_recalculate' USING ERRCODE='40001';
 END IF;
 IF v_preview->>'state'<>'READY' OR
    (v_preview->>'requiredShortfallVnd')::numeric<>0 THEN
   RAISE EXCEPTION 'multi_day_payout_shortfall_unfunded' USING ERRCODE='23514';
 END IF;
 v_receipt:=pg_catalog.jsonb_build_object('ok',true,'state','FINALIZED_OBLIGATIONS',
    'eventId',p_event_id,'finalTournamentId',v_preview->>'finalTournamentId',
    'rulesVersion',p_expected_rules_version,
    'fundingRevision',p_expected_funding_revision,
    'qualificationRevision',p_expected_qualification_revision,
    'payoutInputHash',p_expected_payout_input_hash,
    'recordedOverlayVnd',v_preview->'recordedOverlayVnd',
    'requiredShortfallVnd',0,'paidPlayerVnd',v_preview->'paidPlayerVnd',
    'unpaidObligationVnd',v_preview->'unpaidObligationVnd',
    'clubRetainedTieVnd',v_preview->'clubRetainedTieVnd',
    'unallocatedPoolVnd',v_preview->'unallocatedPoolVnd',
    'paymentExecution','NOT_PERFORMED','idempotent',false);
 INSERT INTO public.multi_day_payout_finalizations_v1(event_id,club_id,
   final_tournament_id,request_id,actor_id,request_hash,rules_version,
   funding_revision,qualification_revision,payout_input_hash,direct_pool_vnd,
   transfer_pool_vnd,fee_vnd,recorded_overlay_vnd,required_shortfall_vnd,paid_player_vnd,
   unpaid_obligation_vnd,club_retained_tie_vnd,unallocated_pool_vnd,
   obligations,tie_batches,source_snapshot,receipt)
 VALUES(p_event_id,v_event.club_id,(v_preview->>'finalTournamentId')::uuid,
   p_request_id,v_actor,v_hash,p_expected_rules_version,p_expected_funding_revision,
   p_expected_qualification_revision,p_expected_payout_input_hash,
   (v_preview->>'directPoolVnd')::bigint,(v_preview->>'transferPoolVnd')::bigint,
   (v_preview->>'feesVnd')::bigint,(v_preview->>'recordedOverlayVnd')::bigint,
   0,(v_preview->>'paidPlayerVnd')::bigint,(v_preview->>'unpaidObligationVnd')::bigint,
   (v_preview->>'clubRetainedTieVnd')::bigint,
   (v_preview->>'unallocatedPoolVnd')::bigint,v_preview->'obligations',
   v_preview->'tieBatches',
   v_preview->'sourceSnapshot',v_receipt);
 RETURN v_receipt;
END $function$
;
DROP FUNCTION private.multi_day_unified_obligation_accounting_v1(uuid);
DROP FUNCTION private.reconcile_multi_day_individual_obligations_v1(uuid,jsonb);
