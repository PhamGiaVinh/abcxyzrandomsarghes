-- Reviewed compensation SOURCE, not an active/replayable migration.
-- Copy unchanged into a NEW catalog version only after reviewed recovery/release.
-- Restore all callers atomically BEFORE revoking/dropping shared implementations.
-- No card, event, receipt, hand or ledger rows are changed.
BEGIN;
DO $guard$
DECLARE item record;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 FOR item IN SELECT * FROM (VALUES
('commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)','49454de61d8beab357877a0c4f7748f3','50c0bfc930229878ad12871916f9d33b'),
('commit_tracker_voice_board_v0(uuid,text,text)','360cb1872c04cf9185dbe7e2362d3ffb','119b0999d96bbd1a91669fa36dfaaf84'),
('show_hole_cards(uuid,jsonb,uuid)','1abb19cb93839c91c0f6e52466905cf1','96399235193e83c08e6c89f92bceae34'),
('update_community_cards(uuid,jsonb,uuid)','162b0102d6f7b5181198aa9d562c2fbf','47750426aac235be7179e0d31b25e29e'),
('_tracker_voice_hand_state_version(uuid)','f1f8d600607c96653f1ea1c0f950c119','c5d9197b60ac937af59d84d124d101cf'),
('_tracker_card_board_source_v1(uuid,jsonb,uuid,boolean)','f6bfc487e7c3f316f754b7fed51ff85f','8fdc7bfaaf3aebddafb11a9c773aa1c6'),
('_tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)','53374e21fe6d323affa8a074402f4b85','1294c860307841192807a24dcefe0eb3')
 ) AS pins(signature,digest,metadata) LOOP
  IF md5(replace(pg_get_functiondef(item.signature::regprocedure),chr(13),''))<>item.digest THEN RAISE EXCEPTION 'rollback70_definition_drift: %',item.signature; END IF;
  IF (SELECT md5(jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'argnames',proargnames)::text) FROM pg_proc WHERE oid=item.signature::regprocedure)<>item.metadata THEN RAISE EXCEPTION 'rollback70_metadata_drift: %',item.signature; END IF;
 END LOOP;
END;
$guard$;
CREATE OR REPLACE FUNCTION public._tracker_voice_hand_state_version(p_hand_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT public._tracker_voice_request_hash(jsonb_build_object(
    'hand', jsonb_build_object(
      'id', h.id,
      'tournament_id', h.tournament_id,
      'table_id', h.table_id,
      'status', h.status,
      'street', COALESCE((
        SELECT ha.street
        FROM public.hand_actions ha
        WHERE ha.hand_id = h.id
        ORDER BY ha.action_order DESC, ha.id DESC
        LIMIT 1
      ), 'preflop'),
      'community_cards', COALESCE(h.community_cards, '[]'::JSONB),
      -- Lock ownership is validated separately by the canonical writer.
      -- It must not invalidate an otherwise unchanged Voice proposal when
      -- its authenticated operator claims or refreshes the hand lock.
      'source_revision', COALESCE(h.source_revision, 1)
    ),
    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'player_id', hp.player_id,
        'entry_number', hp.entry_number,
        'seat_number', hp.seat_number,
        'starting_stack', hp.starting_stack,
        'hole_cards', COALESCE(hp.hole_cards, '[]'::JSONB)
      ) ORDER BY hp.seat_number, hp.player_id, hp.entry_number)
      FROM public.hand_players hp
      WHERE hp.hand_id = h.id
    ), '[]'::JSONB),
    'actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ha.id,
        'player_id', ha.player_id,
        'entry_number', ha.entry_number,
        'street', COALESCE(ha.street, 'preflop'),
        'action_type', ha.action_type,
        'action_amount', COALESCE(ha.action_amount, 0),
        'action_order', ha.action_order
      ) ORDER BY ha.action_order, ha.id)
      FROM public.hand_actions ha
      WHERE ha.hand_id = h.id
    ), '[]'::JSONB)
  ))
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id;
$function$;

CREATE OR REPLACE FUNCTION public.commit_tracker_voice_board_v0(p_voice_event_id uuid, p_idempotency_key text, p_trace_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_root RECORD;
  v_existing_receipt RECORD;
  v_assignment JSONB;
  v_config RECORD;
  v_hand RECORD;
  v_request JSONB;
  v_payload JSONB;
  v_previous JSONB;
  v_cards JSONB;
  v_expected_count INTEGER;
  v_street TEXT;
  v_before TEXT;
  v_after TEXT;
  v_result JSONB;
  v_receipt_id UUID := gen_random_uuid();
  v_receipt JSONB;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  IF p_idempotency_key IS NULL OR p_trace_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key'); END IF;
  SELECT * INTO v_root FROM public.tracker_voice_events e
  WHERE e.id = p_voice_event_id AND e.event_kind = 'final_transcript' AND e.actor_user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'voice_event_not_found'); END IF;
  IF v_root.idempotency_key <> p_idempotency_key OR v_root.execution_mode <> 'assist'
     OR v_root.normalized_command->>'intent_domain' <> 'board' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_event_payload_mismatch');
  END IF;
  SELECT * INTO v_existing_receipt FROM public.tracker_voice_events e
  WHERE e.root_event_id = v_root.id AND e.event_kind = 'canonical_receipt' FOR UPDATE;
  IF FOUND THEN RETURN v_existing_receipt.receipt || jsonb_build_object('duplicate', true); END IF;

  v_request := v_root.normalized_command->'canonical_request';
  v_payload := v_request->'payload';
  v_street := v_payload->>'street';
  v_cards := v_payload->'cumulativeCards';
  BEGIN v_expected_count := (v_payload->>'expectedExistingBoardCount')::INTEGER; EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_board_payload'); END;
  IF v_street NOT IN ('flop', 'turn', 'river') OR jsonb_typeof(v_cards) <> 'array'
     OR v_expected_count NOT IN (0, 3, 4) THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_board_payload'); END IF;
  IF (v_street = 'flop' AND (v_expected_count <> 0 OR jsonb_array_length(v_cards) <> 3))
     OR (v_street = 'turn' AND (v_expected_count <> 3 OR jsonb_array_length(v_cards) <> 4))
     OR (v_street = 'river' AND (v_expected_count <> 4 OR jsonb_array_length(v_cards) <> 5)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_board_payload');
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(v_root.tournament_id);
  v_assignment := public._tracker_voice_assignment_context(v_root.tournament_id, v_root.tournament_table_id, v_actor);
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN RETURN v_assignment; END IF;
  SELECT * INTO v_config FROM public.tracker_voice_configs c
  WHERE c.tournament_id = v_root.tournament_id AND c.tournament_table_id = v_root.tournament_table_id FOR UPDATE;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE OR v_config.correction_state <> 'ready' THEN RETURN jsonb_build_object('ok', false, 'error', 'voice_not_ready'); END IF;
  IF v_config.configured_mode = 'shadow' THEN RETURN jsonb_build_object('ok', false, 'error', 'assist_not_allowed'); END IF;
  IF v_config.physical_table_id <> (v_assignment->>'physical_table_id')::UUID
     OR v_config.club_id <> (v_assignment->>'club_id')::UUID THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_config_scope_mismatch');
  END IF;
  IF v_config.provider_model IN ('gemini-3.1-flash-live-preview', 'gemini-3.5-transcribe-live') THEN
    IF v_root.provider_name <> 'gemini_live' OR v_root.provider_model <> v_config.provider_model THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
    END IF;
  ELSIF v_root.provider_name <> 'openai_realtime' OR v_root.provider_model <> v_config.provider_model THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;
  SELECT h.* INTO v_hand FROM public.tournament_hands h WHERE h.id = v_root.hand_id FOR UPDATE;
  IF NOT FOUND OR v_hand.tournament_id IS DISTINCT FROM v_root.tournament_id
     OR v_hand.table_id IS DISTINCT FROM v_root.tournament_table_id
     OR v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_scope_mismatch');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN RETURN jsonb_build_object('ok', false, 'error', 'lock_lost'); END IF;
  v_before := public._tracker_voice_hand_state_version(v_root.hand_id);
  IF v_before <> v_root.state_version THEN RETURN jsonb_build_object('ok', false, 'error', 'stale_state_version'); END IF;
  v_previous := COALESCE(v_hand.community_cards, '[]'::JSONB);
  IF jsonb_array_length(v_previous) <> v_expected_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'board_already_persisted');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_cards) AS new_card(card)
    JOIN public.hand_players hp ON hp.hand_id = v_root.hand_id
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(hp.hole_cards, '[]'::JSONB)) AS used_card(card)
    WHERE new_card.card = used_card.card
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'card_already_used_by_hole_cards');
  END IF;
  v_result := public.update_community_cards(v_root.hand_id, v_cards, v_actor);
  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;
  v_after := public._tracker_voice_hand_state_version(v_root.hand_id);
  v_receipt := jsonb_build_object('ok', true, 'voice_event_id', v_root.id,
    'canonical_receipt_event_id', v_receipt_id, 'idempotency_key', p_idempotency_key, 'trace_id', p_trace_id,
    'street', v_street, 'previous_board', v_previous, 'community_cards', v_cards,
    'state_version_before', v_before, 'state_version_after', v_after);
  INSERT INTO public.tracker_voice_events (
    id, root_event_id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id, dealer_id,
    assignment_id, actor_user_id, event_kind, provider_name, provider_model, normalized_command, state_version,
    execution_mode, execution_result, validation_mode, turn_order_enforced, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_receipt_id, v_root.id, v_root.club_id, v_root.tournament_id, v_root.tournament_table_id, v_root.physical_table_id,
    v_root.hand_id, v_root.dealer_id, v_root.assignment_id, v_actor, 'canonical_receipt', v_root.provider_name,
    v_root.provider_model, v_root.normalized_command, v_after, 'assist', 'committed', 'enforce', true,
    p_idempotency_key, public._tracker_voice_request_hash(jsonb_build_object('root_event_id', v_root.id, 'community_cards', v_cards)),
    p_trace_id, v_receipt
  );
  RETURN v_receipt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_tracker_voice_hole_cards_v0(p_actor_user_id uuid, p_tournament_id uuid, p_tournament_table_id uuid, p_hand_id uuid, p_provider_name text, p_provider_model text, p_provider_event_id text, p_expected_state_version text, p_idempotency_key text, p_trace_id text, p_seat_number integer, p_hole_cards jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assignment JSONB;
  v_config RECORD;
  v_hand RECORD;
  v_target RECORD;
  v_existing RECORD;
  v_existing_receipt RECORD;
  v_request_hash TEXT;
  v_state_before TEXT;
  v_state_after TEXT;
  v_core_result JSONB;
  v_root_event_id UUID := gen_random_uuid();
  v_receipt_event_id UUID := gen_random_uuid();
  v_live_count INTEGER := 0;
  v_all_in_count INTEGER := 0;
  v_redacted_transcript TEXT;
  v_normalized_command JSONB;
  v_receipt JSONB;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;
  IF p_actor_user_id IS NULL
     OR p_seat_number NOT BETWEEN 1 AND 10
     OR p_expected_state_version !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$'
     OR p_trace_id IS NULL OR char_length(p_trace_id) NOT BETWEEN 8 AND 255
     OR jsonb_typeof(p_hole_cards) <> 'array' OR jsonb_array_length(p_hole_cards) <> 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_hole_cards_request');
  END IF;

  -- Serializing on the canonical tournament before the idempotency lookup makes
  -- concurrent same-key confirms return the original receipt, not a second write.
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  v_request_hash := public._tracker_voice_request_hash(jsonb_build_object(
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id,
    'provider_name', p_provider_name,
    'provider_model', p_provider_model,
    'provider_event_id', p_provider_event_id,
    'state_version', p_expected_state_version,
    'seat_number', p_seat_number,
    'hole_cards', p_hole_cards,
    'execution_mode', 'assist'
  ));
  SELECT * INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = p_actor_user_id
    AND e.idempotency_key = p_idempotency_key
    AND e.event_kind = 'final_transcript'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
    END IF;
    SELECT * INTO v_existing_receipt
    FROM public.tracker_voice_events e
    WHERE e.root_event_id = v_existing.id AND e.event_kind = 'canonical_receipt';
    IF FOUND THEN RETURN v_existing_receipt.receipt || jsonb_build_object('duplicate', true); END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'voice_event_incomplete');
  END IF;

  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, p_actor_user_id
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN RETURN v_assignment; END IF;
  SELECT * INTO v_config FROM public.tracker_voice_configs c
  WHERE c.tournament_id = p_tournament_id
    AND c.tournament_table_id = p_tournament_table_id
  FOR UPDATE;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE OR v_config.correction_state <> 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_not_ready');
  END IF;
  IF v_config.configured_mode = 'shadow' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assist_not_allowed');
  END IF;
  IF v_config.physical_table_id <> (v_assignment->>'physical_table_id')::UUID
     OR v_config.club_id <> (v_assignment->>'club_id')::UUID THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_config_scope_mismatch');
  END IF;
  IF v_config.provider_model IN ('gemini-3.1-flash-live-preview', 'gemini-3.5-transcribe-live') THEN
    IF p_provider_name <> 'gemini_live' OR p_provider_model <> v_config.provider_model THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
    END IF;
  ELSIF p_provider_name <> 'openai_realtime' OR p_provider_model <> v_config.provider_model THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;

  SELECT h.* INTO v_hand
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id
    AND h.tournament_id = p_tournament_id
    AND h.table_id = p_tournament_table_id
  FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_scope_mismatch');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, p_actor_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lock_lost');
  END IF;
  v_state_before := public._tracker_voice_hand_state_version(p_hand_id);
  IF v_state_before <> p_expected_state_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_state_version', 'state_version', v_state_before);
  END IF;
  IF jsonb_array_length(COALESCE(v_hand.community_cards, '[]'::JSONB)) >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'showdown_hole_cards_deferred_muck_authority');
  END IF;

  -- Canonical action history, not a browser draft, must prove either that all
  -- live players are all-in or that one covering player has matched the top.
  IF NOT public._tracker_voice_runout_reveal_authoritative_v1(p_hand_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'runout_reveal_not_authoritative');
  END IF;

  SELECT hp.player_id, hp.entry_number, hp.hole_cards
  INTO v_target
  FROM public.hand_players hp
  WHERE hp.hand_id = p_hand_id AND hp.seat_number = p_seat_number
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'hole_cards_seat_not_found'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.hand_actions ha
    WHERE ha.hand_id = p_hand_id
      AND ha.player_id = v_target.player_id
      AND ha.entry_number = v_target.entry_number
      AND ha.action_type = 'fold'
  ) THEN RETURN jsonb_build_object('ok', false, 'error', 'player_folded'); END IF;

  IF COALESCE(v_target.hole_cards, '[]'::JSONB) <> '[]'::JSONB THEN
    IF v_target.hole_cards = p_hole_cards THEN
      RETURN jsonb_build_object('ok', false, 'error', 'hole_cards_already_persisted');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'voice_hole_card_correction_required');
  END IF;

  -- The canonical public writer mutates exactly one explicit entry. A later
  -- root/receipt failure raises and rolls this mutation back atomically.
  v_core_result := public.show_hole_cards(
    p_hand_id,
    jsonb_build_array(jsonb_build_object(
      'player_id', v_target.player_id,
      'entry_number', v_target.entry_number,
      'hole_cards', p_hole_cards
    )),
    p_actor_user_id
  );
  IF v_core_result->>'error' IS NOT NULL THEN
    RETURN v_core_result || jsonb_build_object('ok', false);
  END IF;

  v_redacted_transcript := format('Seat %s [HOLE_CARDS_REDACTED]', p_seat_number);
  v_normalized_command := jsonb_build_object(
    'kind', 'hole_cards',
    'intent_domain', 'hole_cards',
    'redacted', true,
    'seat_number', p_seat_number,
    'actor_player_id', v_target.player_id,
    'entry_number', v_target.entry_number,
    'hardener_version', 'none-private-hole-cards-v1',
    'grammar_version', 'dealer-hole-cards-v1',
    'vocabulary_version', 'poker-dealer-v2',
    'requires_confirmation', true
  );
  INSERT INTO public.tracker_voice_events (
    id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id, dealer_id,
    assignment_id, actor_user_id, actor_player_id, event_kind, provider_name, provider_model,
    provider_event_id, final_transcript, normalized_command, state_version, execution_mode,
    execution_result, validation_mode, turn_order_enforced, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_root_event_id, (v_assignment->>'club_id')::UUID, p_tournament_id, p_tournament_table_id,
    (v_assignment->>'physical_table_id')::UUID, p_hand_id, (v_assignment->>'dealer_id')::UUID,
    (v_assignment->>'assignment_id')::UUID, p_actor_user_id, v_target.player_id, 'final_transcript',
    p_provider_name, p_provider_model, NULLIF(p_provider_event_id, ''), v_redacted_transcript,
    v_normalized_command, v_state_before, 'assist', 'validated', 'enforce', true,
    p_idempotency_key, v_request_hash, p_trace_id, jsonb_build_object('redacted', true)
  );
  v_state_after := public._tracker_voice_hand_state_version(p_hand_id);
  v_receipt := jsonb_build_object(
    'ok', true,
    'voice_event_id', v_root_event_id,
    'canonical_receipt_event_id', v_receipt_event_id,
    'idempotency_key', p_idempotency_key,
    'trace_id', p_trace_id,
    'seat_number', p_seat_number,
    'player_id', v_target.player_id,
    'entry_number', v_target.entry_number,
    'redacted', true,
    'state_version_before', v_state_before,
    'state_version_after', v_state_after
  );
  INSERT INTO public.tracker_voice_events (
    id, root_event_id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id,
    dealer_id, assignment_id, actor_user_id, actor_player_id, event_kind, provider_name, provider_model,
    normalized_command, state_version, execution_mode, execution_result, validation_mode,
    turn_order_enforced, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_receipt_event_id, v_root_event_id, (v_assignment->>'club_id')::UUID, p_tournament_id,
    p_tournament_table_id, (v_assignment->>'physical_table_id')::UUID, p_hand_id,
    (v_assignment->>'dealer_id')::UUID, (v_assignment->>'assignment_id')::UUID, p_actor_user_id,
    v_target.player_id, 'canonical_receipt', p_provider_name, p_provider_model, v_normalized_command,
    v_state_after, 'assist', 'committed', 'enforce', true, p_idempotency_key,
    public._tracker_voice_request_hash(jsonb_build_object('root_event_id', v_root_event_id, 'redacted', true)),
    p_trace_id, v_receipt
  );
  RETURN v_receipt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.show_hole_cards(p_hand_id uuid, p_player_hole_cards jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_service_voice_call BOOLEAN := COALESCE(auth.jwt()->>'role', '') = 'service_role';
  v_hand RECORD;
  v_item JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_cards JSONB;
  v_validation TEXT;
  v_entry_count INTEGER := 0;
  v_seen_entries TEXT[] := ARRAY[]::TEXT[];
  v_seen_cards TEXT[] := ARRAY[]::TEXT[];
  v_entry_key TEXT;
BEGIN
  -- The service-only Voice transaction supplies the already-authenticated
  -- Dealer identity. Direct callers still bind p_user_id to auth.uid().
  IF v_service_voice_call THEN v_actor := p_user_id; END IF;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('error', 'unauthenticated'); END IF;
  IF NOT v_service_voice_call AND p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'actor_mismatch');
  END IF;
  IF jsonb_typeof(p_player_hole_cards) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
  END IF;
  SELECT h.status, h.locked_by_user_id, h.locked_at, h.tournament_id, h.table_id,
         h.community_cards, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'hand_not_found'); END IF;
  IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.dealers d
      JOIN public.dealer_assignments da ON da.dealer_id = d.id
      JOIN public.tournament_tables tt ON tt.table_id = da.table_id
      WHERE d.user_id = v_actor
        AND d.club_id = v_hand.club_id
        AND da.status = 'assigned'
        AND da.released_at IS NULL
        AND tt.id = v_hand.table_id
        AND tt.tournament_id = v_hand.tournament_id
    ) THEN RETURN jsonb_build_object('error', 'actor_not_allowed'); END IF;
  END IF;
  IF v_hand.status <> 'in_progress' THEN RETURN jsonb_build_object('error', 'hand_not_in_progress'); END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN
    RETURN jsonb_build_object('error', 'lock_lost');
  END IF;

  -- Lock every existing entry for this hand before enforcing deck uniqueness
  -- and applying the explicit additive batch.
  PERFORM 1 FROM public.hand_players hp WHERE hp.hand_id = p_hand_id FOR UPDATE;

  -- Validate the entire additive batch before the first source mutation.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_player_hole_cards) LOOP
    BEGIN
      v_player_id := (v_item->>'player_id')::UUID;
      v_entry_number := (v_item->>'entry_number')::INTEGER;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END;
    v_cards := v_item->'hole_cards';
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR v_player_id IS NULL OR v_entry_number IS NULL OR v_entry_number < 1
       OR jsonb_typeof(v_cards) IS DISTINCT FROM 'array' THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END IF;
    v_entry_key := v_player_id::TEXT || ':' || v_entry_number::TEXT;
    IF v_entry_key = ANY(v_seen_entries) THEN
      RETURN jsonb_build_object('error', 'duplicate_hole_cards_participant');
    END IF;
    v_seen_entries := array_append(v_seen_entries,v_entry_key);
    v_validation := public.validate_cards(v_cards);
    IF v_validation IS DISTINCT FROM 'ok' OR jsonb_array_length(v_cards) <> 2 THEN
      RETURN jsonb_build_object('error',COALESCE(NULLIF(v_validation,'ok'),'invalid_hole_cards_payload'));
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=p_hand_id
      AND hp.player_id=v_player_id AND hp.entry_number=v_entry_number) THEN
      RETURN jsonb_build_object('error','player_not_in_hand');
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_cards) proposed(card)
      WHERE proposed.card = ANY(v_seen_cards) OR proposed.card IN (
        SELECT jsonb_array_elements_text(COALESCE(v_hand.community_cards,'[]'::JSONB))
        UNION
        SELECT jsonb_array_elements_text(COALESCE(hp.hole_cards,'[]'::JSONB))
        FROM public.hand_players hp WHERE hp.hand_id=p_hand_id
        AND (hp.player_id,hp.entry_number)<>(v_player_id,v_entry_number))) THEN
      RETURN jsonb_build_object('error','card_already_used_by_board_or_hole_cards');
    END IF;
    v_seen_cards := v_seen_cards || ARRAY(SELECT jsonb_array_elements_text(v_cards));
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_player_hole_cards) LOOP
    BEGIN
      v_player_id := (v_item->>'player_id')::UUID;
      v_entry_number := (v_item->>'entry_number')::INTEGER;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END;
    v_cards := v_item->'hole_cards';
    IF v_player_id IS NULL OR v_entry_number IS NULL OR v_entry_number < 1
       OR jsonb_typeof(v_cards) <> 'array' THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END IF;
    v_validation := public.validate_cards(v_cards);
    IF v_validation <> 'ok' OR jsonb_array_length(v_cards) <> 2 THEN
      RETURN jsonb_build_object('error', COALESCE(NULLIF(v_validation, 'ok'), 'invalid_hole_cards_payload'));
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.hand_players hp
      WHERE hp.hand_id = p_hand_id
        AND hp.player_id = v_player_id
        AND hp.entry_number = v_entry_number
    ) THEN RETURN jsonb_build_object('error', 'player_not_in_hand'); END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_cards) AS proposed(card)
      WHERE proposed.card IN (
        SELECT jsonb_array_elements_text(COALESCE(v_hand.community_cards, '[]'::JSONB))
        UNION
        SELECT jsonb_array_elements_text(COALESCE(other_hp.hole_cards, '[]'::JSONB))
        FROM public.hand_players other_hp
        WHERE other_hp.hand_id = p_hand_id
          AND (other_hp.player_id, other_hp.entry_number) <> (v_player_id, v_entry_number)
          AND COALESCE(other_hp.hole_cards, '[]'::JSONB) <> '[]'::JSONB
      )
    ) THEN RETURN jsonb_build_object('error', 'card_already_used_by_board_or_hole_cards'); END IF;
    UPDATE public.hand_players
    SET hole_cards = v_cards
    WHERE hand_id = p_hand_id
      AND player_id = v_player_id
      AND entry_number = v_entry_number;
    v_entry_count := v_entry_count + 1;
  END LOOP;
  UPDATE public.tournament_hands SET updated_at = now(), locked_at = now() WHERE id = p_hand_id;
  RETURN jsonb_build_object('status', 'success', 'entry_count', v_entry_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_community_cards(p_hand_id uuid, p_community_cards jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_hand RECORD;
  v_validation TEXT;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('error', 'unauthenticated'); END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN RETURN jsonb_build_object('error', 'actor_mismatch'); END IF;

  SELECT h.status, h.locked_by_user_id, h.locked_at, h.tournament_id, h.table_id, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Hand not found'); END IF;
  IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
    IF current_user <> pg_get_userbyid((
      SELECT p.proowner
      FROM pg_proc p
      WHERE p.oid = 'public.update_community_cards(uuid,jsonb,uuid)'::regprocedure
    )) OR NOT EXISTS (
      SELECT 1
      FROM public.dealers d
      JOIN public.dealer_assignments da ON da.dealer_id = d.id
      JOIN public.tournament_tables tt ON tt.table_id = da.table_id
      WHERE d.user_id = v_actor
        AND d.club_id = v_hand.club_id
        AND da.status = 'assigned'
        AND da.released_at IS NULL
        AND tt.id = v_hand.table_id
        AND tt.tournament_id = v_hand.tournament_id
    ) THEN
      RETURN jsonb_build_object('error', 'actor_not_allowed');
    END IF;
  END IF;
  IF v_hand.status <> 'in_progress' THEN RETURN jsonb_build_object('error', 'Hand is not in progress', 'status', v_hand.status); END IF;
  IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NULL THEN RETURN jsonb_build_object('error', 'tracker_lock_required'); END IF;
  IF v_hand.locked_by_user_id IS NULL OR v_hand.locked_at IS NULL THEN RETURN jsonb_build_object('error', 'tracker_lock_ambiguous'); END IF;
  IF v_hand.locked_at <= now() - public.tracker_lock_ttl() THEN RETURN jsonb_build_object('error', 'tracker_lock_expired'); END IF;
  IF v_hand.locked_by_user_id <> v_actor THEN RETURN jsonb_build_object('error', 'tracker_lock_owned_by_another', 'locked_by', v_hand.locked_by_user_id); END IF;
  IF jsonb_typeof(p_community_cards) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('error', 'invalid_community_cards_payload');
  END IF;
  v_validation := public.validate_cards(p_community_cards);
  IF v_validation != 'ok' THEN RETURN jsonb_build_object('error', v_validation); END IF;
  IF jsonb_array_length(p_community_cards) NOT IN (0, 3, 4, 5) THEN
    RETURN jsonb_build_object('error', 'Invalid number of community cards', 'count', jsonb_array_length(p_community_cards));
  END IF;

  -- The hand lock serializes both board and hole-card writers.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_community_cards) proposed(card)
    JOIN public.hand_players hp ON hp.hand_id=p_hand_id
    WHERE COALESCE(hp.hole_cards,'[]'::JSONB) ? proposed.card) THEN
    RETURN jsonb_build_object('error','card_already_used_by_hole_cards');
  END IF;

  UPDATE public.tournament_hands
  SET community_cards = p_community_cards, updated_at = NOW(), locked_at = NOW()
  WHERE id = p_hand_id;
  RETURN jsonb_build_object('status', 'success');
END;
$function$;
REVOKE ALL ON FUNCTION public._tracker_card_board_source_v1(uuid,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public._tracker_card_board_source_v1(uuid,jsonb,uuid,boolean) RESTRICT;
DROP FUNCTION public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean) RESTRICT;
DO $postcheck$
BEGIN
 IF md5(replace(pg_get_functiondef('_tracker_voice_hand_state_version(uuid)'::regprocedure),chr(13),''))<>'02fb54cede4cf42423abe72271375a8b' THEN RAISE EXCEPTION 'rollback70_original_postcheck: _tracker_voice_hand_state_version(uuid)'; END IF;
 IF md5(replace(pg_get_functiondef('commit_tracker_voice_board_v0(uuid,text,text)'::regprocedure),chr(13),''))<>'a2690a56143d9cce0210e66c13e2763a' THEN RAISE EXCEPTION 'rollback70_original_postcheck: commit_tracker_voice_board_v0(uuid,text,text)'; END IF;
 IF md5(replace(pg_get_functiondef('commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)'::regprocedure),chr(13),''))<>'d065ca95f25b40a7783e647a57019e40' THEN RAISE EXCEPTION 'rollback70_original_postcheck: commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)'; END IF;
 IF md5(replace(pg_get_functiondef('show_hole_cards(uuid,jsonb,uuid)'::regprocedure),chr(13),''))<>'320f5edc67f9ac874b89684d872447c3' THEN RAISE EXCEPTION 'rollback70_original_postcheck: show_hole_cards(uuid,jsonb,uuid)'; END IF;
 IF md5(replace(pg_get_functiondef('update_community_cards(uuid,jsonb,uuid)'::regprocedure),chr(13),''))<>'fad65f1d894c364249dd51f25ac06dde' THEN RAISE EXCEPTION 'rollback70_original_postcheck: update_community_cards(uuid,jsonb,uuid)'; END IF;
END;
$postcheck$;
COMMIT;
