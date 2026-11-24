-- DRAFT coordinated release: requires matching Edge, readers and hand-input UI.
-- Existing hands keep their frozen rule. Only new Tracker hands use BB-only ante.
-- Rollback: stop new hand creation, restore the prior snapshot function through a
-- reviewed forward migration, and retain receipts/rules for already-started hands.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.tournament_hands
  ADD COLUMN tracker_big_blind_ante_only boolean NOT NULL DEFAULT false;

CREATE TABLE floor_private.tracker_blind_receipts350 (
  hand_id uuid PRIMARY KEY REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  result jsonb NOT NULL
);
ALTER TABLE floor_private.tracker_blind_receipts350 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tracker_blind_receipts350 FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the existing session/level/position checks and function privileges.
DO $freeze$
DECLARE
  definition text;
  anchor text := '  NEW.tracker_bba := v_level.ante;';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'floor_private.snapshot_tracker_hand_blinds()'::regprocedure
      AND proowner = 'postgres'::regrole AND prosecdef
  ) THEN RAISE EXCEPTION 'tracker_bba_snapshot_authority_mismatch'; END IF;
  definition := replace(pg_get_functiondef('floor_private.snapshot_tracker_hand_blinds()'::regprocedure), chr(13), '');
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'tracker_bba_snapshot_dependency_drift';
  END IF;
  EXECUTE replace(definition, anchor,
    '  NEW.tracker_bba := v_level.big_blind;' || chr(10) ||
    '  NEW.tracker_big_blind_ante_only := true;');
END;
$freeze$;

CREATE FUNCTION public.post_tracker_blinds_v1(p_hand_id uuid, p_request_id uuid, p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'
AS $body$
DECLARE
  actor uuid := auth.uid();
  hand public.tournament_hands%ROWTYPE;
  bb public.hand_players%ROWTYPE;
  sb public.hand_players%ROWTYPE;
  club uuid;
  session_id uuid;
  saved jsonb;
  reply jsonb;
  actions jsonb;
  sb_paid integer := 0;
  bb_paid integer;
  ante_paid integer;
  action_order integer := 0;
  previous_batch text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_hand_id IS NULL OR p_request_id IS NULL OR p_tournament_id IS NULL THEN RAISE EXCEPTION 'tracker_blinds_invalid_request'; END IF;
  SELECT h.table_session_id, t.club_id INTO session_id, club
  FROM public.tournament_hands h JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id AND h.tournament_id = p_tournament_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tracker_blinds_hand_missing'; END IF;
  IF NOT public.is_club_tracker(actor, club) THEN RAISE EXCEPTION 'actor_not_allowed'; END IF;

  -- Control transfer and duplicate writers serialize on the same session/hand.
  PERFORM 1 FROM public.table_sessions WHERE id = session_id FOR UPDATE;
  SELECT * INTO STRICT hand FROM public.tournament_hands WHERE id = p_hand_id AND tournament_id = p_tournament_id FOR UPDATE;
  SELECT result INTO saved FROM floor_private.tracker_blind_receipts350 WHERE hand_id = p_hand_id;
  IF FOUND THEN RETURN saved || jsonb_build_object('duplicate', true); END IF;
  IF hand.status <> 'in_progress' OR coalesce(hand.is_voided, false)
     OR NOT hand.tracker_big_blind_ante_only THEN
    RAISE EXCEPTION 'tracker_blinds_hand_rule_unavailable';
  END IF;
  IF hand.locked_by_user_id IS DISTINCT FROM actor OR hand.locked_at IS NULL
     OR hand.locked_at <= now() - public.tracker_lock_ttl() THEN
    RAISE EXCEPTION 'tracker_blinds_lock_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.table_sessions s
    WHERE s.id = hand.table_session_id AND s.tournament_id = hand.tournament_id
      AND s.control_mode = 'tracker' AND s.closed_at IS NULL) THEN
    RAISE EXCEPTION 'tracker_blinds_session_unavailable';
  END IF;
  IF hand.tracker_small_blind IS NULL OR hand.tracker_small_blind <= 0
     OR hand.tracker_big_blind IS NULL OR hand.tracker_big_blind < hand.tracker_small_blind
     OR hand.tracker_bba IS DISTINCT FROM hand.tracker_big_blind
     OR hand.tracker_bb_position IS NULL
     OR hand.tracker_sb_position = hand.tracker_bb_position THEN
    RAISE EXCEPTION 'tracker_blinds_frozen_evidence_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hand_actions WHERE hand_id = p_hand_id) THEN
    RAISE EXCEPTION 'tracker_blinds_actions_already_started';
  END IF;
  SELECT * INTO STRICT bb FROM public.hand_players
  WHERE hand_id = p_hand_id AND seat_number = hand.tracker_bb_position;
  IF bb.starting_stack IS NULL OR bb.starting_stack < 0 THEN
    RAISE EXCEPTION 'tracker_blinds_stack_missing';
  END IF;
  bb_paid := least(hand.tracker_big_blind, bb.starting_stack);
  ante_paid := least(hand.tracker_big_blind, bb.starting_stack - bb_paid);
  IF hand.tracker_sb_position IS NOT NULL THEN
    BEGIN
      SELECT * INTO STRICT sb FROM public.hand_players
      WHERE hand_id = p_hand_id AND seat_number = hand.tracker_sb_position;
    EXCEPTION WHEN no_data_found THEN
      -- A frozen SB position may be empty under the existing dead-SB rule.
      NULL;
    END;
    IF sb.player_id IS NOT NULL THEN
      IF sb.starting_stack IS NULL OR sb.starting_stack < 0 THEN
        RAISE EXCEPTION 'tracker_blinds_stack_missing';
      END IF;
      sb_paid := least(hand.tracker_small_blind, sb.starting_stack);
    END IF;
  END IF;

  previous_batch := current_setting('vinpoker.blind_batch_hand', true);
  PERFORM set_config('vinpoker.blind_batch_hand', p_hand_id::text, true);
  IF sb.player_id IS NOT NULL THEN
    action_order := action_order + 1;
    reply := public.record_action(p_hand_id, sb.player_id, 'post_sb', action_order, sb.entry_number,
      'preflop', sb_paid, 'blind350:' || p_hand_id || ':sb', p_request_id::text, actor);
    IF reply->>'status' IS DISTINCT FROM 'success' OR reply ? 'error' THEN
      RAISE EXCEPTION 'tracker_blinds_sb_rejected: %', reply;
    END IF;
  END IF;
  -- Reserve BB first, while the presentation records ante before the BB push.
  IF ante_paid > 0 THEN
    action_order := action_order + 1;
    reply := public.record_action(p_hand_id, bb.player_id, 'post_ante', action_order, bb.entry_number,
      'preflop', ante_paid, 'blind350:' || p_hand_id || ':ante', p_request_id::text, actor);
    IF reply->>'status' IS DISTINCT FROM 'success' OR reply ? 'error' THEN
      RAISE EXCEPTION 'tracker_blinds_ante_rejected: %', reply;
    END IF;
  END IF;
  action_order := action_order + 1;
  reply := public.record_action(p_hand_id, bb.player_id, 'post_bb', action_order, bb.entry_number,
    'preflop', bb_paid, 'blind350:' || p_hand_id || ':bb', p_request_id::text, actor);
  IF reply->>'status' IS DISTINCT FROM 'success' OR reply ? 'error' THEN
    RAISE EXCEPTION 'tracker_blinds_bb_rejected: %', reply;
  END IF;
  PERFORM set_config('vinpoker.blind_batch_hand', coalesce(previous_batch, ''), true);

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'player_id', a.player_id,
    'entry_number', a.entry_number, 'street', a.street, 'action_type', a.action_type,
    'action_amount', a.action_amount, 'action_order', a.action_order) ORDER BY a.action_order), '[]'::jsonb)
  INTO actions FROM public.hand_actions a WHERE a.hand_id = p_hand_id;
  saved := jsonb_build_object('status', 'success', 'hand_id', p_hand_id,
    'big_blind_ante_only', true, 'small_blind', hand.tracker_small_blind,
    'big_blind', hand.tracker_big_blind, 'ante', hand.tracker_bba,
    'sb_paid', sb_paid, 'bb_paid', bb_paid, 'ante_paid', ante_paid, 'actions', actions);
  INSERT INTO floor_private.tracker_blind_receipts350(hand_id, request_id, actor_id, result)
  VALUES (p_hand_id, p_request_id, actor, saved);
  RETURN saved || jsonb_build_object('duplicate', false);
END;
$body$;
ALTER FUNCTION public.post_tracker_blinds_v1(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.post_tracker_blinds_v1(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_tracker_blinds_v1(uuid, uuid, uuid) TO authenticated;

CREATE FUNCTION floor_private.guard_tracker_blind_batch350()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $guard$
DECLARE uses_bb_ante boolean;
BEGIN
  SELECT tracker_big_blind_ante_only INTO uses_bb_ante
  FROM public.tournament_hands WHERE id = NEW.hand_id FOR UPDATE;
  IF NOT coalesce(uses_bb_ante, false) THEN RETURN NEW; END IF;
  IF NEW.action_type IN ('post_sb', 'post_bb', 'post_ante') THEN
    IF current_setting('vinpoker.blind_batch_hand', true) IS DISTINCT FROM NEW.hand_id::text THEN
      RAISE EXCEPTION 'tracker_blinds_atomic_batch_required';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM floor_private.tracker_blind_receipts350 WHERE hand_id = NEW.hand_id) THEN
    RAISE EXCEPTION 'tracker_blinds_not_confirmed';
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION floor_private.guard_tracker_blind_batch350() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_guard_tracker_blind_batch350 BEFORE INSERT ON public.hand_actions
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tracker_blind_batch350();

CREATE FUNCTION floor_private.guard_tracker_ante_rule350()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $rule$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tracker_big_blind_ante_only IS DISTINCT FROM OLD.tracker_big_blind_ante_only THEN
      RAISE EXCEPTION 'tracker_ante_rule_immutable';
    END IF;
  ELSIF current_user <> 'postgres' AND NEW.tracker_big_blind_ante_only THEN
    RAISE EXCEPTION 'tracker_ante_rule_server_owned';
  END IF;
  RETURN NEW;
END;
$rule$;
REVOKE ALL ON FUNCTION floor_private.guard_tracker_ante_rule350() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_guard_tracker_ante_rule350 BEFORE INSERT OR UPDATE OF tracker_big_blind_ante_only
ON public.tournament_hands FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tracker_ante_rule350();

COMMIT;
