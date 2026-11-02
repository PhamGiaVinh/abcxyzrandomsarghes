-- LOCAL candidate only: existing signature/owner/options/privileges are preserved.
-- No stock valuation formula, authorization branch, grants, policies or new objects.
DO $stock300$
DECLARE source text; definition text; candidate text := $stock300body$
DECLARE
  v_uid uuid := auth.uid();
  v_crid text;
  v_intent jsonb;
  v_prior public.fnb_stock_movements%ROWTYPE;
  v_ing public.fnb_ingredients%ROWTYPE;
  v_qty_stock numeric;
  v_cost_per_unit numeric;
  v_new_onhand numeric;
  v_new_avg numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF p_qty_purchase IS NULL OR p_qty_purchase <= 0 THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'qty'); END IF;
  IF p_unit_cost_purchase IS NULL OR p_unit_cost_purchase < 0 THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'cost'); END IF;
  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);
  v_intent := jsonb_build_object('version', 1, 'club_id', p_club_id,
    'ingredient_id', p_ingredient_id, 'qty_purchase', p_qty_purchase,
    'unit_cost_purchase', p_unit_cost_purchase);
  SELECT * INTO v_prior FROM public.fnb_stock_movements
    WHERE club_id = p_club_id AND client_request_id = v_crid;
  IF FOUND THEN
    IF v_prior.details->'stock_in_intent_v1' IS NULL THEN
      RETURN jsonb_build_object('error', 'STOCK_IN_INTENT_UNVERIFIED');
    END IF;
    IF v_prior.details->'stock_in_intent_v1' IS DISTINCT FROM v_intent THEN
      RETURN jsonb_build_object('error', 'STOCK_IN_REQUEST_CONFLICT');
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true);
  END IF;
  BEGIN
    SELECT * INTO v_ing FROM public.fnb_ingredients WHERE id = p_ingredient_id AND club_id = p_club_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INGREDIENT_NOT_FOUND'; END IF;
    v_qty_stock := p_qty_purchase * v_ing.units_per_purchase;
    v_cost_per_unit := p_unit_cost_purchase / v_ing.units_per_purchase;
    v_new_onhand := v_ing.on_hand + v_qty_stock;
    v_new_avg := CASE
      WHEN v_new_onhand <= 0 THEN v_ing.avg_unit_cost
      ELSE (GREATEST(v_ing.on_hand, 0) * v_ing.avg_unit_cost + v_qty_stock * v_cost_per_unit) / v_new_onhand
    END;
    UPDATE public.fnb_ingredients
      SET on_hand = v_new_onhand, avg_unit_cost = v_new_avg, version = version + 1, updated_at = now()
      WHERE id = p_ingredient_id;
    INSERT INTO public.fnb_stock_movements
      (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, client_request_id, actor, details)
    VALUES (p_club_id, p_ingredient_id, v_qty_stock, 'stock_in', v_cost_per_unit, v_new_onhand, 'manual', v_crid, v_uid,
      jsonb_build_object('stock_in_intent_v1', v_intent));
  EXCEPTION WHEN unique_violation THEN
    -- The failed subtransaction rolls back its stock update before examining the winner.
    SELECT * INTO v_prior FROM public.fnb_stock_movements
      WHERE club_id = p_club_id AND client_request_id = v_crid;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'STOCK_IN_RECEIPT_UNAVAILABLE'); END IF;
    IF v_prior.details->'stock_in_intent_v1' IS NULL THEN
      RETURN jsonb_build_object('error', 'STOCK_IN_INTENT_UNVERIFIED');
    END IF;
    IF v_prior.details->'stock_in_intent_v1' IS DISTINCT FROM v_intent THEN
      RETURN jsonb_build_object('error', 'STOCK_IN_REQUEST_CONFLICT');
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true);
  END;
  RETURN jsonb_build_object('status', 'ok', 'ingredient_id', p_ingredient_id,
                            'on_hand', v_new_onhand, 'avg_unit_cost', v_new_avg);
END;
$stock300body$;
BEGIN
  SELECT prosrc INTO source FROM pg_proc
    WHERE oid='public.fnb_stock_in(uuid,uuid,numeric,numeric,text)'::regprocedure;
  IF md5(source)='67e707fdb0cf139843191b06201539a8' THEN RETURN; END IF;
  IF md5(source) IS DISTINCT FROM '1289355dbf6cdfddca6b1f5738f34cfb' THEN
    RAISE EXCEPTION 'fnb_stock_in source drift; expected 1289355dbf6cdfddca6b1f5738f34cfb';
  END IF;
  SELECT pg_get_functiondef('public.fnb_stock_in(uuid,uuid,numeric,numeric,text)'::regprocedure) INTO definition;
  IF position(source IN definition)=0 THEN RAISE EXCEPTION 'stock body anchor missing'; END IF;
  EXECUTE replace(definition,source,candidate);
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_stock_in(uuid,uuid,numeric,numeric,text)'::regprocedure) <> '67e707fdb0cf139843191b06201539a8' THEN
    RAISE EXCEPTION 'stock body verification failed';
  END IF;
END $stock300$;
