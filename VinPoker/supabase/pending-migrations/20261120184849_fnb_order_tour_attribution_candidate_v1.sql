-- Candidate only. Preserve attribution when a physical table is reused.
-- Rollback: turn off new UI entry, disable the capture trigger, and revoke the linked sale and comp writers. Keep receipt recovery and existing attribution rows.
-- Existing orders stay unattributed. Daily finance continues using its existing ledger.
BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS floor_private.fnb_order_tour_attribution_v1 (
  order_id uuid PRIMARY KEY REFERENCES public.fnb_orders(id) ON DELETE CASCADE,
  club_id uuid NOT NULL,
  game_table_id uuid NOT NULL,
  table_session_id uuid NOT NULL,
  tournament_id uuid NOT NULL
);
ALTER TABLE floor_private.fnb_order_tour_attribution_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_order_tour_attribution_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION floor_private.capture_fnb_order_tour_attribution_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Counter staff may select a real table while retaining source='counter'.
  IF NEW.table_ref IS NULL THEN
    RETURN NEW;
  END IF;

  -- Floor open/close takes the same physical-table lock. Consult the session
  -- only after this lock, including when closing gets there before the order.
  PERFORM 1 FROM public.game_tables
  WHERE id = NEW.table_ref AND club_id = NEW.club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO floor_private.fnb_order_tour_attribution_v1
    (order_id, club_id, game_table_id, table_session_id, tournament_id)
  SELECT NEW.id, NEW.club_id, s.game_table_id, s.id, s.tournament_id
  FROM public.table_sessions s
  JOIN public.tournament_tables tt
    ON tt.table_session_id = s.id
    AND tt.game_table_id = s.game_table_id
    AND tt.tournament_id = s.tournament_id
  JOIN public.tournaments t ON t.id = s.tournament_id AND t.club_id = s.club_id
  WHERE s.club_id = NEW.club_id AND s.game_table_id = NEW.table_ref
    AND s.session_type = 'tournament' AND s.closed_at IS NULL
    AND tt.status = 'active';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.capture_fnb_order_tour_attribution_v1() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER fnb_order_tour_attribution_v1
AFTER INSERT ON public.fnb_orders
FOR EACH ROW EXECUTE FUNCTION floor_private.capture_fnb_order_tour_attribution_v1();
CREATE INDEX IF NOT EXISTS fnb_order_tour_attribution_tour_idx
ON floor_private.fnb_order_tour_attribution_v1 (club_id, tournament_id, order_id);

CREATE OR REPLACE FUNCTION public.get_tour_fnb_attribution_v1(
  p_club_id uuid,
  p_tournament_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  result jsonb;
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = p_club_id AND (
      c.owner_id = actor
      OR EXISTS (SELECT 1 FROM public.club_accountants a WHERE a.club_id = c.id AND a.user_id = actor)
      OR EXISTS (SELECT 1 FROM public.user_roles u WHERE u.user_id = actor AND u.role = 'super_admin')
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'invalid_reporting_period' USING ERRCODE = '22023';
  END IF;

  WITH attributed AS (
    SELECT o.id, o.subtotal_vnd, o.cogs_vnd, o.is_comp, o.shipped_at,
           o.paid_at >= p_from AND o.paid_at < p_to AS sale_in_period,
           o.status = 'cancelled' AND o.cancelled_at >= p_from AND o.cancelled_at < p_to AS reversal_in_period
    FROM floor_private.fnb_order_tour_attribution_v1 a
    JOIN public.fnb_orders o ON o.id = a.order_id AND o.club_id = a.club_id
    WHERE a.club_id = p_club_id AND a.tournament_id = p_tournament_id
      AND o.paid_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'clubId', p_club_id,
    'tournamentId', p_tournament_id,
    'coverage', 'captured_orders_only',
    'revenue', COALESCE(sum(subtotal_vnd) FILTER (WHERE sale_in_period AND NOT COALESCE(is_comp, false)), 0)
      - COALESCE(sum(subtotal_vnd) FILTER (WHERE reversal_in_period AND NOT COALESCE(is_comp, false)), 0),
    'cogs', COALESCE(sum(cogs_vnd) FILTER (WHERE sale_in_period), 0)
      - COALESCE(sum(floor_private.fnb_cancel_cogs_reversal_v1(id, cogs_vnd, shipped_at))
        FILTER (WHERE reversal_in_period), 0),
    'sales', count(*) FILTER (WHERE sale_in_period),
    'reversals', count(*) FILTER (WHERE reversal_in_period)
  ) INTO result FROM attributed;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_tour_fnb_attribution_v1(uuid,uuid,timestamptz,timestamptz)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tour_fnb_attribution_v1(uuid,uuid,timestamptz,timestamptz) TO authenticated;
-- A linked comp must name the exact session chosen by the operator.
CREATE OR REPLACE FUNCTION public.fnb_create_tour_comp_candidate_v1(
  p_club_id uuid,
  p_table_session_id uuid,
  p_customer_name text,
  p_note text,
  p_lines jsonb,
  p_comp_reason text,
  p_client_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  request_key text := nullif(btrim(p_client_request_id), '');
  physical uuid;
  tour uuid;
  label text;
  existing public.fnb_orders%ROWTYPE;
  linked floor_private.fnb_order_tour_attribution_v1%ROWTYPE;
  result jsonb;
BEGIN
  IF actor IS NULL OR p_club_id IS NULL OR p_table_session_id IS NULL
    OR request_key IS NULL OR length(request_key) > 200 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT');
  END IF;
  IF NOT (public.is_club_fnb_kind(actor, p_club_id, 'cashier')
          OR public.is_club_owner(actor, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  -- Legacy comp acquires the club cash-event gate before the request key.
  PERFORM floor_private.fnb_cash_event_gate_v1(p_club_id);
  -- Match the existing receipt lock before reading or creating the order.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || request_key, 0));
  SELECT * INTO existing FROM public.fnb_orders
  WHERE club_id = p_club_id AND client_request_id = request_key;
  IF FOUND THEN
    SELECT * INTO linked FROM floor_private.fnb_order_tour_attribution_v1
    WHERE order_id = existing.id AND club_id = p_club_id;
    IF NOT FOUND OR NOT COALESCE(existing.is_comp, false)
      OR linked.table_session_id IS DISTINCT FROM p_table_session_id THEN
      RETURN jsonb_build_object('error', 'REQUEST_ID_CONFLICT');
    END IF;
    RETURN public.fnb_create_comp_order(p_club_id, 'table', existing.table_label,
      p_customer_name, p_note, p_lines, p_comp_reason, request_key);
  END IF;

  SELECT game_table_id INTO physical FROM public.table_sessions
  WHERE id = p_table_session_id AND club_id = p_club_id;
  SELECT table_name INTO label FROM public.game_tables
  WHERE id = physical AND club_id = p_club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TABLE_SESSION_CHANGED'); END IF;

  SELECT s.tournament_id INTO tour
  FROM public.table_sessions s
  JOIN public.tournament_tables tt ON tt.table_session_id = s.id
    AND tt.game_table_id = s.game_table_id AND tt.tournament_id = s.tournament_id
  JOIN public.tournaments t ON t.id = s.tournament_id AND t.club_id = s.club_id
  WHERE s.id = p_table_session_id AND s.club_id = p_club_id AND s.game_table_id = physical
    AND s.closed_at IS NULL AND s.session_type = 'tournament' AND tt.status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TABLE_SESSION_CHANGED'); END IF;

  result := public.fnb_create_comp_order(p_club_id, 'table', label,
    p_customer_name, p_note, p_lines, p_comp_reason, request_key);
  IF result->>'status' = 'ok' THEN
    INSERT INTO floor_private.fnb_order_tour_attribution_v1
      (order_id, club_id, game_table_id, table_session_id, tournament_id)
    VALUES ((result->>'order_id')::uuid, p_club_id, physical, p_table_session_id, tour);
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.fnb_create_tour_comp_candidate_v1(uuid,uuid,text,text,jsonb,text,text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fnb_create_tour_comp_candidate_v1(uuid,uuid,text,text,jsonb,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.fnb_get_tour_comp_receipt_candidate_v1(
  p_club_id uuid, p_request_id text, p_expected_actor uuid, p_table_session_id uuid, p_operation text DEFAULT 'comp'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  receipt jsonb;
BEGIN
  receipt := public.fnb_get_create_receipt_v1(p_club_id, p_request_id, p_expected_actor);
  IF receipt->>'status' = 'cancelled' THEN
    IF receipt->>'operation' IS DISTINCT FROM p_operation OR receipt#>>'{intent,table_session_id}' IS DISTINCT FROM p_table_session_id::text THEN
      RETURN jsonb_build_object('error', 'REQUEST_ID_CONFLICT');
    END IF;
    RETURN receipt || jsonb_build_object('table_session_id', p_table_session_id);
  END IF;
  IF receipt->>'status' IS DISTINCT FROM 'found' THEN
    RETURN receipt;
  END IF;
  IF receipt->>'operation' IS DISTINCT FROM p_operation OR NOT EXISTS (
    SELECT 1 FROM floor_private.fnb_order_tour_attribution_v1 a
    WHERE a.order_id = (receipt#>>'{order,id}')::uuid
      AND a.club_id = p_club_id AND a.table_session_id = p_table_session_id
  ) THEN
    RETURN jsonb_build_object('error', 'REQUEST_ID_CONFLICT');
  END IF;
  RETURN receipt || jsonb_build_object('table_session_id', p_table_session_id,
    'intent', (receipt->'intent') || jsonb_build_object('source','counter','table',NULL,'table_session_id',p_table_session_id));
END;
$$;
REVOKE ALL ON FUNCTION public.fnb_get_tour_comp_receipt_candidate_v1(uuid,text,uuid,uuid,text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fnb_get_tour_comp_receipt_candidate_v1(uuid,text,uuid,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.fnb_cancel_tour_comp_candidate_v1(
  p_club_id uuid, p_request_id text, p_expected_actor uuid, p_table_session_id uuid, p_payload jsonb, p_operation text DEFAULT 'comp'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  receipt jsonb;
BEGIN
  IF p_table_session_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR p_payload->>'source' IS DISTINCT FROM 'counter' THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT');
  END IF;
  IF auth.uid() IS NULL OR p_expected_actor IS DISTINCT FROM auth.uid()
    OR NOT (public.is_club_fnb_kind(auth.uid(), p_club_id, 'cashier') OR public.is_club_owner(auth.uid(), p_club_id)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  -- Serialize with the create wrapper and the existing request journal.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || p_request_id, 0));
  receipt := public.fnb_get_tour_comp_receipt_candidate_v1(
    p_club_id, p_request_id, p_expected_actor, p_table_session_id, p_operation);
  IF receipt->>'status' IN ('found', 'cancelled') OR receipt ? 'error' THEN
    RETURN receipt;
  END IF;
  RETURN public.fnb_cancel_create_intent_v1(p_club_id, p_request_id, p_expected_actor, p_operation,
    p_payload || jsonb_build_object('table_session_id', p_table_session_id))
    || jsonb_build_object('table_session_id', p_table_session_id);
END;
$$;
REVOKE ALL ON FUNCTION public.fnb_cancel_tour_comp_candidate_v1(uuid,text,uuid,uuid,jsonb,text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fnb_cancel_tour_comp_candidate_v1(uuid,text,uuid,uuid,jsonb,text) TO authenticated;
-- The base reader remains responsible for membership and exact table/session eligibility.
CREATE OR REPLACE FUNCTION public.fnb_list_link_targets_with_session_type_v1(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  payload jsonb := public.fnb_list_link_targets(p_club_id);
  tables jsonb;
BEGIN
  IF payload->>'status' IS DISTINCT FROM 'ok' THEN RETURN payload; END IF;
  SELECT COALESCE(jsonb_agg(item.row || jsonb_build_object('session_type', s.session_type)
                          ORDER BY item.ordinal), '[]'::jsonb)
    INTO tables
  FROM jsonb_array_elements(payload->'tables') WITH ORDINALITY AS item(row, ordinal)
  LEFT JOIN public.table_sessions s ON s.id = (item.row->>'table_session_id')::uuid
    AND s.club_id = p_club_id AND s.game_table_id = (item.row->>'id')::uuid;
  RETURN payload || jsonb_build_object('tables', tables);
END;
$$;
REVOKE ALL ON FUNCTION public.fnb_list_link_targets_with_session_type_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fnb_list_link_targets_with_session_type_v1(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.fnb_create_tour_order_candidate_v1(
  p_club_id uuid, p_table_session_id uuid, p_table_ref uuid, p_player_ref uuid,
  p_customer_name text, p_note text, p_lines jsonb, p_client_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  request_key text := nullif(btrim(p_client_request_id), '');
  existing public.fnb_orders%ROWTYPE;
BEGIN
  IF actor IS NULL OR p_club_id IS NULL OR p_table_session_id IS NULL OR p_table_ref IS NULL
    OR request_key IS NULL OR length(request_key) > 200 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT');
  END IF;
  IF NOT (public.is_club_fnb_kind(actor, p_club_id, 'cashier')
          OR public.is_club_owner(actor, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || request_key, 0));
  SELECT * INTO existing FROM public.fnb_orders
  WHERE club_id = p_club_id AND client_request_id = request_key;

  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM floor_private.fnb_order_tour_attribution_v1 a
      WHERE a.order_id = existing.id AND a.club_id = p_club_id
        AND a.table_session_id = p_table_session_id AND a.game_table_id = p_table_ref
    ) OR COALESCE(existing.is_comp, false) THEN
      RETURN jsonb_build_object('error', 'REQUEST_ID_CONFLICT');
    END IF;
  ELSE
    PERFORM 1 FROM public.game_tables
    WHERE id = p_table_ref AND club_id = p_club_id FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.table_sessions s
      JOIN public.tournament_tables tt ON tt.table_session_id = s.id
        AND tt.game_table_id = s.game_table_id AND tt.tournament_id = s.tournament_id
      JOIN public.tournaments t ON t.id = s.tournament_id AND t.club_id = s.club_id
      WHERE s.id = p_table_session_id AND s.game_table_id = p_table_ref AND s.club_id = p_club_id
        AND s.closed_at IS NULL AND s.session_type = 'tournament' AND tt.status = 'active'
    ) THEN
      RETURN jsonb_build_object('error', 'TABLE_SESSION_CHANGED');
    END IF;
  END IF;

  RETURN public.fnb_create_order(p_club_id, 'counter', NULL, p_customer_name,
    p_note, p_lines, request_key, p_table_ref, p_player_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.fnb_create_tour_order_candidate_v1(uuid,uuid,uuid,uuid,text,text,jsonb,text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fnb_create_tour_order_candidate_v1(uuid,uuid,uuid,uuid,text,text,jsonb,text) TO authenticated;
COMMIT;
