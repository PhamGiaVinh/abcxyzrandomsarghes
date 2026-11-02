-- Prospective paid-line inventory snapshots; no historical backfill or payment rewrite.
-- Cancel returns only eligible inventory at original acquisition cost.
-- Booked refund COGS follows immutable cancellation receipt / actual legacy return ledger.
-- Local acceptance uses BEGIN/DDL/RPC/ROLLBACK; production promotion remains owner-gated.
CREATE TABLE floor_private.fnb_paid_line_snapshot_v1 (
 line_id uuid PRIMARY KEY REFERENCES public.fnb_order_items(id),
 order_id uuid NOT NULL REFERENCES public.fnb_orders(id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 qty integer NOT NULL CHECK(qty>0),
 unit_cost numeric NOT NULL CHECK(unit_cost>=0),
 ingredients jsonb NOT NULL CHECK(jsonb_typeof(ingredients)='array'),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX fnb_paid_line_snapshot_order_v1 ON floor_private.fnb_paid_line_snapshot_v1(order_id);
ALTER TABLE floor_private.fnb_paid_line_snapshot_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_paid_line_snapshot_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.fnb_paid_line_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN RAISE EXCEPTION 'fnb_paid_line_snapshot_immutable' USING ERRCODE='55000';END $fn$;
REVOKE ALL ON FUNCTION floor_private.fnb_paid_line_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fnb_paid_line_immutable_v1 BEFORE UPDATE OR DELETE ON floor_private.fnb_paid_line_snapshot_v1
 FOR EACH ROW EXECUTE FUNCTION floor_private.fnb_paid_line_immutable_v1();
CREATE FUNCTION floor_private.fnb_capture_paid_lines_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM public.fnb_order_items oi LEFT JOIN public.fnb_menu_items mi ON mi.id=oi.menu_item_id
  WHERE oi.order_id=NEW.id AND(oi.club_id<>NEW.club_id OR mi.id IS NULL OR mi.club_id<>NEW.club_id)) THEN
  RAISE EXCEPTION 'fnb_paid_line_snapshot_scope_mismatch';END IF;
 INSERT INTO floor_private.fnb_paid_line_snapshot_v1(line_id,order_id,club_id,qty,unit_cost,ingredients)
 SELECT oi.id,oi.order_id,oi.club_id,oi.qty,oi.unit_cost_snapshot,
  coalesce((SELECT jsonb_agg(jsonb_build_object('ingredient_id',ri.ingredient_id,'qty',ri.qty*oi.qty,'unit_cost',i.avg_unit_cost) ORDER BY ri.ingredient_id)
   FROM public.fnb_recipe_items ri JOIN public.fnb_ingredients i ON i.id=ri.ingredient_id
   WHERE ri.menu_item_id=oi.menu_item_id),'[]'::jsonb)
 FROM public.fnb_order_items oi WHERE oi.order_id=NEW.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'fnb_paid_line_snapshot_empty';END IF;
 IF (SELECT round(sum(s.unit_cost*s.qty)) FROM floor_private.fnb_paid_line_snapshot_v1 s WHERE s.order_id=NEW.id) IS DISTINCT FROM NEW.cogs_vnd THEN
  RAISE EXCEPTION 'fnb_paid_line_snapshot_cost_mismatch';END IF;
 IF EXISTS(
  WITH actual AS(SELECT ingredient_id,-sum(delta) qty FROM public.fnb_stock_movements WHERE ref_type='order' AND ref_id=NEW.id AND reason='sale' GROUP BY ingredient_id),
  captured AS(SELECT x.ingredient_id,sum(x.qty) qty FROM floor_private.fnb_paid_line_snapshot_v1 s
   CROSS JOIN LATERAL jsonb_to_recordset(s.ingredients) AS x(ingredient_id uuid,qty numeric,unit_cost numeric)
   WHERE s.order_id=NEW.id GROUP BY x.ingredient_id)
  SELECT 1 FROM actual a FULL JOIN captured c USING(ingredient_id) WHERE coalesce(a.qty,0)<>coalesce(c.qty,0)
 ) THEN RAISE EXCEPTION 'fnb_paid_line_snapshot_inventory_mismatch';END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION floor_private.fnb_capture_paid_lines_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fnb_capture_paid_lines_v1 AFTER UPDATE OF status ON public.fnb_orders
 FOR EACH ROW WHEN(NEW.status='paid' AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL)
 EXECUTE FUNCTION floor_private.fnb_capture_paid_lines_v1();


CREATE OR REPLACE FUNCTION public.fnb_mark_paid(p_order_id uuid, p_client_request_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_order     public.fnb_orders%ROWTYPE;
  v_shortages jsonb;
  v_norecipe  jsonb;
  v_need      record;
  v_after     numeric;
  v_avg       numeric;
  v_subtotal  bigint;
  v_cogs      bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  PERFORM floor_private.fnb_cash_event_gate_v1((SELECT o.club_id FROM public.fnb_orders o WHERE o.id=p_order_id));
  SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  -- [GQR] cashier/owner as before; PLUS the server facet for TABLE-source CASH orders only
  --       (the at-the-table collection flow). Counter and bank orders keep the original rule.
  IF NOT (public.is_club_fnb_kind(v_uid, v_order.club_id, 'cashier') OR public.is_club_owner(v_uid, v_order.club_id)
          OR (public.is_club_fnb_kind(v_uid, v_order.club_id, 'server')
              AND v_order.source = 'table' AND v_order.payment_method = 'cash')) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id, 'idempotent', true);
  END IF;
  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'BAD_STATE', 'status', v_order.status);
  END IF;

  -- (P0-3) RECIPE REQUIRED: block PAID if any active line's item tracks inventory but has NO recipe.
  --   An item explicitly flagged tracks_inventory=false is an owner exemption (sell, COGS 0, no decrement).
  --   Evaluated at PAID time (not snapshotted at create). Tx aborts → order stays pending, retryable.
  -- Serialize recipe/price edits with the exact paid snapshot, menu before ingredient locks.
  PERFORM mi.id FROM public.fnb_menu_items mi WHERE mi.id IN(SELECT oi.menu_item_id FROM public.fnb_order_items oi WHERE oi.order_id=p_order_id) ORDER BY mi.id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'menu_item_id', oi.menu_item_id, 'name', oi.name_snapshot, 'qty', oi.qty)), '[]'::jsonb)
    INTO v_norecipe
  FROM public.fnb_order_items oi
  JOIN public.fnb_menu_items mi ON mi.id = oi.menu_item_id
  WHERE oi.order_id = p_order_id
    AND COALESCE(mi.tracks_inventory, true)
    AND NOT EXISTS (SELECT 1 FROM public.fnb_recipe_items ri WHERE ri.menu_item_id = oi.menu_item_id);
  IF jsonb_array_length(v_norecipe) > 0 THEN
    RAISE EXCEPTION 'RECIPE_REQUIRED' USING DETAIL = v_norecipe::text, ERRCODE = 'check_violation';
  END IF;

  -- (1)(9) lock EVERY needed ingredient in a fixed id order BEFORE any check or mutation.
  PERFORM 1 FROM public.fnb_ingredients i
  WHERE i.id IN (
    SELECT DISTINCT ri.ingredient_id
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
  )
  ORDER BY i.id
  FOR UPDATE;

  -- (2) #A = BLOCK: collect every short ingredient; if any, abort the WHOLE tx via RAISE.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ingredient_id', s.ingredient_id, 'name', s.name, 'need', s.need, 'on_hand', s.on_hand)), '[]'::jsonb)
    INTO v_shortages
  FROM (
    SELECT ri.ingredient_id, ing.name, SUM(oi.qty * ri.qty) AS need, ing.on_hand
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.ingredient_id, ing.name, ing.on_hand
    HAVING SUM(oi.qty * ri.qty) > ing.on_hand
  ) s;

  IF jsonb_array_length(v_shortages) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING DETAIL = v_shortages::text, ERRCODE = 'check_violation';
  END IF;

  -- (4) freeze revenue: re-read live menu prices onto the lines at the payment instant.
  UPDATE public.fnb_order_items oi
    SET unit_price_snapshot = mi.price_vnd
    FROM public.fnb_menu_items mi
    WHERE oi.order_id = p_order_id AND mi.id = oi.menu_item_id;

  -- decrement stock + append one 'sale' ledger row per ingredient, in the same fixed id order.
  FOR v_need IN
    SELECT ri.ingredient_id AS ingredient_id, SUM(oi.qty * ri.qty) AS need
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.ingredient_id
    ORDER BY ri.ingredient_id
  LOOP
    UPDATE public.fnb_ingredients
      SET on_hand = on_hand - v_need.need, version = version + 1, updated_at = now()
      WHERE id = v_need.ingredient_id
      RETURNING on_hand, avg_unit_cost INTO v_after, v_avg;
    INSERT INTO public.fnb_stock_movements
      (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, ref_id, actor)
    VALUES
      (v_order.club_id, v_need.ingredient_id, -v_need.need, 'sale', v_avg, v_after, 'order', p_order_id, v_uid);
  END LOOP;

  -- (4) freeze COGS per line (Σ recipe.qty × avg_unit_cost at sale time); avg is unchanged by a sale.
  UPDATE public.fnb_order_items oi
    SET unit_cost_snapshot = COALESCE((
      SELECT SUM(ri.qty * ing.avg_unit_cost)
      FROM public.fnb_recipe_items ri
      JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.menu_item_id = oi.menu_item_id
    ), 0)
    WHERE oi.order_id = p_order_id;

  SELECT COALESCE(SUM(unit_price_snapshot * qty), 0),
         COALESCE(ROUND(SUM(unit_cost_snapshot * qty)), 0)
    INTO v_subtotal, v_cogs
  FROM public.fnb_order_items WHERE order_id = p_order_id;

  UPDATE public.fnb_orders
    SET status = 'paid', paid_by = v_uid, paid_at = clock_timestamp(),
        subtotal_vnd = v_subtotal, cogs_vnd = v_cogs, updated_at = now()
    WHERE id = p_order_id;
  UPDATE public.fnb_order_items SET line_status = 'paid' WHERE order_id = p_order_id;
  INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status, actor)
  VALUES (p_order_id, v_order.club_id, 'paid', 'pending', 'paid', v_uid);

  RETURN jsonb_build_object('status', 'ok', 'order_id', p_order_id,
                            'subtotal_vnd', v_subtotal, 'cogs_vnd', v_cogs, 'idempotent', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fnb_create_comp_order(p_club_id uuid, p_source fnb_order_source, p_table_label text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_comp_reason text DEFAULT NULL::text, p_client_request_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_crid      text;
  v_order_id  uuid;
  v_shortages jsonb;
  v_norecipe  jsonb;
  v_need      record;
  v_after     numeric;
  v_avg       numeric;
  v_cogs      bigint;
  v_line      jsonb;
  v_qty       int;
  v_mi        record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  -- Only cashier facet or owner can authorise a comp — servers cannot self-issue freebies.
  IF NOT (public.is_club_fnb_kind(v_uid, p_club_id, 'cashier')
          OR public.is_club_owner(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden', 'detail', 'comp requires cashier or owner');
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'empty lines');
  END IF;

  PERFORM floor_private.fnb_cash_event_gate_v1(p_club_id);
  IF NOT(public.is_club_fnb_kind(v_uid,p_club_id,'cashier') OR public.is_club_owner(v_uid,p_club_id)) THEN RETURN jsonb_build_object('error','Forbidden','detail','comp requires cashier or owner');END IF;
  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);
  IF NOT public._fnb_bind_create_intent_v1(v_uid,p_club_id,v_crid,'comp',jsonb_build_object('source',p_source,'table',p_table_label,'customer',p_customer_name,'note',p_note,'lines',p_lines,'reason',p_comp_reason)) THEN
    RETURN jsonb_build_object('error','REQUEST_ID_CONFLICT');
  END IF;

  -- Create the order (status=pending) with comp flags set.
  BEGIN
    INSERT INTO public.fnb_orders
      (club_id, status, source, table_label, customer_name, note,
       is_comp, comp_reason, comp_authorized_by,
       subtotal_vnd, client_request_id, created_by)
    VALUES
      (p_club_id, 'pending', p_source, p_table_label, p_customer_name, p_note,
       true, p_comp_reason, v_uid,
       0, v_crid, v_uid)
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    -- A retry with the same crid: the comp was already created (and paid atomically).
    SELECT id INTO v_order_id
      FROM public.fnb_orders
      WHERE club_id = p_club_id AND client_request_id = v_crid;
    RETURN jsonb_build_object(
      'status', 'ok', 'order_id', v_order_id, 'is_comp', true, 'idempotent', true);
  END;

  -- Insert order lines (mirror fnb_create_order: validate active menu, snapshot name).
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := COALESCE((v_line->>'qty')::int, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
    SELECT id, name, price_vnd, is_active INTO v_mi
      FROM public.fnb_menu_items
      WHERE id = (v_line->>'menu_item_id')::uuid AND club_id = p_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND %', (v_line->>'menu_item_id');
    END IF;
    IF NOT v_mi.is_active THEN
      RAISE EXCEPTION 'MENU_ITEM_INACTIVE %', v_mi.name;
    END IF;
    INSERT INTO public.fnb_order_items
      (order_id, club_id, menu_item_id, name_snapshot, qty, unit_price_snapshot, line_status)
    VALUES
      (v_order_id, p_club_id, v_mi.id, v_mi.name, v_qty, v_mi.price_vnd, 'pending');
  END LOOP;

  -- ── Atomic PAID path (mirrors fnb_mark_paid from …0010) ─────────────────────────────────

  -- (P0-3) RECIPE REQUIRED: block if any tracked item has no recipe.
  -- Serialize recipe/price edits with the exact paid snapshot, menu before ingredient locks.
  PERFORM mi.id FROM public.fnb_menu_items mi WHERE mi.id IN(SELECT oi.menu_item_id FROM public.fnb_order_items oi WHERE oi.order_id=v_order_id) ORDER BY mi.id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'menu_item_id', oi.menu_item_id,
           'name',         oi.name_snapshot,
           'qty',          oi.qty)), '[]'::jsonb)
    INTO v_norecipe
  FROM public.fnb_order_items oi
  JOIN public.fnb_menu_items mi ON mi.id = oi.menu_item_id
  WHERE oi.order_id = v_order_id
    AND COALESCE(mi.tracks_inventory, true)
    AND NOT EXISTS (
      SELECT 1 FROM public.fnb_recipe_items ri WHERE ri.menu_item_id = oi.menu_item_id
    );
  IF jsonb_array_length(v_norecipe) > 0 THEN
    RAISE EXCEPTION 'RECIPE_REQUIRED'
      USING DETAIL = v_norecipe::text, ERRCODE = 'check_violation';
  END IF;

  -- Lock ingredients in fixed id ORDER (deadlock-safe; same order in cancel + stocktake-commit).
  PERFORM 1 FROM public.fnb_ingredients i
  WHERE i.id IN (
    SELECT DISTINCT ri.ingredient_id
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = v_order_id
  )
  ORDER BY i.id
  FOR UPDATE;

  -- #A BLOCK: comps still consume real stock — abort on shortage.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ingredient_id', s.ingredient_id,
           'name',          s.name,
           'need',          s.need,
           'on_hand',       s.on_hand)), '[]'::jsonb)
    INTO v_shortages
  FROM (
    SELECT ri.ingredient_id, ing.name,
           SUM(oi.qty * ri.qty) AS need, ing.on_hand
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
    WHERE oi.order_id = v_order_id
    GROUP BY ri.ingredient_id, ing.name, ing.on_hand
    HAVING SUM(oi.qty * ri.qty) > ing.on_hand
  ) s;
  IF jsonb_array_length(v_shortages) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK'
      USING DETAIL = v_shortages::text, ERRCODE = 'check_violation';
  END IF;

  -- Decrement stock + append one 'sale' ledger row per ingredient (same as mark_paid).
  FOR v_need IN
    SELECT ri.ingredient_id, SUM(oi.qty * ri.qty) AS need
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = v_order_id
    GROUP BY ri.ingredient_id
    ORDER BY ri.ingredient_id
  LOOP
    UPDATE public.fnb_ingredients
      SET on_hand = on_hand - v_need.need,
          version = version + 1,
          updated_at = now()
      WHERE id = v_need.ingredient_id
      RETURNING on_hand, avg_unit_cost INTO v_after, v_avg;

    INSERT INTO public.fnb_stock_movements
      (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, ref_id, actor)
    VALUES
      (p_club_id, v_need.ingredient_id, -v_need.need, 'sale', v_avg, v_after, 'order', v_order_id, v_uid);
  END LOOP;

  -- Snapshot COGS per line (same formula as mark_paid; subtotal_vnd stays 0).
  UPDATE public.fnb_order_items oi
    SET unit_cost_snapshot = COALESCE((
      SELECT SUM(ri.qty * ing.avg_unit_cost)
      FROM public.fnb_recipe_items ri
      JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.menu_item_id = oi.menu_item_id
    ), 0)
    WHERE oi.order_id = v_order_id;

  SELECT COALESCE(ROUND(SUM(unit_cost_snapshot * qty)), 0)
    INTO v_cogs
  FROM public.fnb_order_items WHERE order_id = v_order_id;

  -- Flip to paid: subtotal_vnd=0 (no money collected); cogs_vnd=real ingredient cost.
  UPDATE public.fnb_orders
    SET status           = 'paid',
        paid_by          = v_uid,
        paid_at          = clock_timestamp(),
        subtotal_vnd     = 0,
        cogs_vnd         = v_cogs,
        updated_at       = now()
    WHERE id = v_order_id;

  UPDATE public.fnb_order_items
    SET line_status = 'paid'
    WHERE order_id = v_order_id;

  INSERT INTO public.fnb_order_events
    (order_id, club_id, action, old_status, new_status, actor, metadata)
  VALUES
    (v_order_id, p_club_id, 'comp_paid', 'pending', 'paid', v_uid,
     jsonb_build_object(
       'is_comp',              true,
       'comp_reason',          p_comp_reason,
       'comp_authorized_by',   v_uid
     ));

  RETURN jsonb_build_object(
    'status',    'ok',
    'order_id',  v_order_id,
    'is_comp',   true,
    'cogs_vnd',  v_cogs,
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fnb_settle_bank_paid(p_order_id uuid, p_bank_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order     public.fnb_orders%ROWTYPE;
  v_old       public.fnb_order_status;
  v_revived   boolean := false;
  v_shortages jsonb;
  v_norecipe  jsonb;
  v_need      record;
  v_after     numeric;
  v_avg       numeric;
  v_subtotal  bigint;
  v_cogs      bigint;
BEGIN
  PERFORM floor_private.fnb_cash_event_gate_v1((SELECT o.club_id FROM public.fnb_orders o WHERE o.id=p_order_id));
  SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND'); END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'idempotent', true);
  END IF;
  IF v_order.status = 'expired' AND v_order.created_at > now() - interval '2 hours' THEN
    v_revived := true;
  ELSIF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_STATE', 'status', v_order.status);
  END IF;
  v_old := v_order.status;

  -- Serialize recipe/price edits with the exact paid snapshot, menu before ingredient locks.
  PERFORM mi.id FROM public.fnb_menu_items mi WHERE mi.id IN(SELECT oi.menu_item_id FROM public.fnb_order_items oi WHERE oi.order_id=p_order_id) ORDER BY mi.id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'menu_item_id', oi.menu_item_id, 'name', oi.name_snapshot, 'qty', oi.qty)), '[]'::jsonb)
    INTO v_norecipe
  FROM public.fnb_order_items oi
  JOIN public.fnb_menu_items mi ON mi.id = oi.menu_item_id
  WHERE oi.order_id = p_order_id
    AND COALESCE(mi.tracks_inventory, true)
    AND NOT EXISTS (SELECT 1 FROM public.fnb_recipe_items ri WHERE ri.menu_item_id = oi.menu_item_id);
  IF jsonb_array_length(v_norecipe) > 0 THEN
    RAISE EXCEPTION 'RECIPE_REQUIRED' USING DETAIL = v_norecipe::text, ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM public.fnb_ingredients i
  WHERE i.id IN (
    SELECT DISTINCT ri.ingredient_id
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
  )
  ORDER BY i.id
  FOR UPDATE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ingredient_id', s.ingredient_id, 'name', s.name, 'need', s.need, 'on_hand', s.on_hand)), '[]'::jsonb)
    INTO v_shortages
  FROM (
    SELECT ri.ingredient_id, ing.name, SUM(oi.qty * ri.qty) AS need, ing.on_hand
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.ingredient_id, ing.name, ing.on_hand
    HAVING SUM(oi.qty * ri.qty) > ing.on_hand
  ) s;
  IF jsonb_array_length(v_shortages) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING DETAIL = v_shortages::text, ERRCODE = 'check_violation';
  END IF;

  FOR v_need IN
    SELECT ri.ingredient_id AS ingredient_id, SUM(oi.qty * ri.qty) AS need
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.ingredient_id
    ORDER BY ri.ingredient_id
  LOOP
    UPDATE public.fnb_ingredients
      SET on_hand = on_hand - v_need.need, version = version + 1, updated_at = now()
      WHERE id = v_need.ingredient_id
      RETURNING on_hand, avg_unit_cost INTO v_after, v_avg;
    INSERT INTO public.fnb_stock_movements
      (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, ref_id, actor)
    VALUES
      (v_order.club_id, v_need.ingredient_id, -v_need.need, 'sale', v_avg, v_after, 'order', p_order_id, NULL);
  END LOOP;

  UPDATE public.fnb_order_items oi
    SET unit_cost_snapshot = COALESCE((
      SELECT SUM(ri.qty * ing.avg_unit_cost)
      FROM public.fnb_recipe_items ri
      JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.menu_item_id = oi.menu_item_id
    ), 0)
    WHERE oi.order_id = p_order_id;

  SELECT COALESCE(SUM(unit_price_snapshot * qty), 0),
         COALESCE(ROUND(SUM(unit_cost_snapshot * qty)), 0)
    INTO v_subtotal, v_cogs
  FROM public.fnb_order_items WHERE order_id = p_order_id;

  UPDATE public.fnb_orders
    SET status = 'paid', paid_by = NULL, paid_at = clock_timestamp(),
        subtotal_vnd = v_subtotal, cogs_vnd = v_cogs, updated_at = now()
    WHERE id = p_order_id;
  UPDATE public.fnb_order_items SET line_status = 'paid' WHERE order_id = p_order_id;
  INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status, actor, metadata)
  VALUES (p_order_id, v_order.club_id, 'paid', v_old, 'paid', NULL,
          jsonb_build_object('via', 'sepay_auto', 'bank_transaction_id', p_bank_transaction_id,
                             'revived', v_revived));

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id,
                            'subtotal_vnd', v_subtotal, 'cogs_vnd', v_cogs,
                            'revived', v_revived, 'idempotent', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fnb_set_recipe(p_menu_item_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_club uuid; v_item jsonb; v_ing uuid; v_qty numeric; v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  SELECT club_id INTO v_club FROM public.fnb_menu_items WHERE id = p_menu_item_id;
  IF v_club IS NULL THEN RETURN jsonb_build_object('error', 'MENU_ITEM_NOT_FOUND'); END IF;
  IF NOT public.is_club_owner(v_uid, v_club) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  PERFORM id FROM public.fnb_menu_items WHERE id=p_menu_item_id FOR UPDATE;
  DELETE FROM public.fnb_recipe_items WHERE menu_item_id = p_menu_item_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_ing := (v_item->>'ingredient_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY %', COALESCE(v_ing::text, '?'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fnb_ingredients WHERE id = v_ing AND club_id = v_club) THEN
      RAISE EXCEPTION 'INGREDIENT_NOT_FOUND %', v_ing;
    END IF;
    INSERT INTO public.fnb_recipe_items (club_id, menu_item_id, ingredient_id, qty)
    VALUES (v_club, p_menu_item_id, v_ing, v_qty)
    ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE SET qty = EXCLUDED.qty;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('status', 'ok', 'menu_item_id', p_menu_item_id, 'items_saved', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fnb_cancel_order(p_order_id uuid,p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_uid uuid:=auth.uid();o public.fnb_orders%ROWTYPE;v_policy boolean;v_any boolean;v_all boolean;v_full boolean:=false;
 v_return jsonb:='[]';v_kept bigint:=0;v_returned bigint:=0;v_after numeric;n record;v_restock boolean:=false;
BEGIN
 IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized');END IF;
 PERFORM floor_private.fnb_cash_event_gate_v1((SELECT club_id FROM public.fnb_orders WHERE id=p_order_id));
 SELECT * INTO o FROM public.fnb_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','ORDER_NOT_FOUND');END IF;
 IF NOT(public.is_club_fnb_kind(v_uid,o.club_id,'cashier') OR public.is_club_owner(v_uid,o.club_id) OR(o.status='pending' AND o.created_by=v_uid)) THEN RETURN jsonb_build_object('error','Forbidden');END IF;
 IF o.status IN('cancelled','expired') THEN RETURN jsonb_build_object('status','ok','order_id',p_order_id,'idempotent',true);END IF;
 PERFORM id FROM public.fnb_order_items WHERE order_id=p_order_id ORDER BY id FOR UPDATE;
 IF o.paid_at IS NOT NULL THEN
  SELECT coalesce((SELECT restock_on_shipped_cancel FROM public.fnb_settings WHERE club_id=o.club_id),false) INTO v_policy;
  SELECT coalesce(bool_or(shipped_at IS NOT NULL),false),coalesce(bool_and(shipped_at IS NOT NULL),false) INTO v_any,v_all FROM public.fnb_order_items WHERE order_id=p_order_id;
  v_full:=v_policy OR NOT v_any;
  IF v_full THEN
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ingredient_id),'[]') INTO v_return FROM(
    SELECT ingredient_id,-sum(delta) qty,sum(-delta*unit_cost)/nullif(-sum(delta),0) unit_cost
    FROM public.fnb_stock_movements WHERE ref_type='order' AND ref_id=p_order_id AND reason='sale'
    GROUP BY ingredient_id HAVING -sum(delta)>0)t;
  ELSIF v_all THEN v_kept:=o.cogs_vnd;
  ELSE
   IF (SELECT count(*) FROM floor_private.fnb_paid_line_snapshot_v1 WHERE order_id=p_order_id)<>(SELECT count(*) FROM public.fnb_order_items WHERE order_id=p_order_id)
    OR EXISTS(SELECT 1 FROM floor_private.fnb_paid_line_snapshot_v1 s JOIN public.fnb_order_items i ON i.id=s.line_id WHERE s.order_id=p_order_id AND(s.qty<>i.qty OR s.unit_cost IS DISTINCT FROM i.unit_cost_snapshot OR s.club_id<>o.club_id)) THEN
    RETURN jsonb_build_object('error','PARTIAL_RETURN_SNAPSHOT_UNAVAILABLE');END IF;
   SELECT coalesce(round(sum(s.unit_cost*s.qty)),0) INTO v_kept FROM floor_private.fnb_paid_line_snapshot_v1 s JOIN public.fnb_order_items i ON i.id=s.line_id WHERE s.order_id=p_order_id AND i.shipped_at IS NOT NULL;
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ingredient_id),'[]') INTO v_return FROM(
    SELECT x.ingredient_id,sum(x.qty) qty,sum(x.qty*x.unit_cost)/nullif(sum(x.qty),0) unit_cost
    FROM floor_private.fnb_paid_line_snapshot_v1 s JOIN public.fnb_order_items i ON i.id=s.line_id
    CROSS JOIN LATERAL jsonb_to_recordset(s.ingredients)AS x(ingredient_id uuid,qty numeric,unit_cost numeric)
    WHERE s.order_id=p_order_id AND i.shipped_at IS NULL GROUP BY x.ingredient_id HAVING sum(x.qty)>0)t;
  END IF;
  v_returned:=o.cogs_vnd-v_kept;
  IF v_returned<0 OR v_kept<0 THEN RAISE EXCEPTION 'fnb_cancel_cost_snapshot_invalid';END IF;
  PERFORM id FROM public.fnb_ingredients WHERE id IN(SELECT x.ingredient_id FROM jsonb_to_recordset(v_return)AS x(ingredient_id uuid,qty numeric,unit_cost numeric)) ORDER BY id FOR UPDATE;
  FOR n IN SELECT * FROM jsonb_to_recordset(v_return)AS x(ingredient_id uuid,qty numeric,unit_cost numeric) ORDER BY ingredient_id LOOP
   UPDATE public.fnb_ingredients SET avg_unit_cost=CASE WHEN on_hand+n.qty>0 THEN(on_hand*avg_unit_cost+n.qty*n.unit_cost)/(on_hand+n.qty)ELSE 0 END,
    on_hand=on_hand+n.qty,version=version+1,updated_at=now() WHERE id=n.ingredient_id AND club_id=o.club_id RETURNING on_hand INTO v_after;
   IF NOT FOUND THEN RAISE EXCEPTION 'fnb_cancel_inventory_scope_invalid';END IF;
   INSERT INTO public.fnb_stock_movements(club_id,ingredient_id,delta,reason,unit_cost,balance_after,ref_type,ref_id,actor,details)
    VALUES(o.club_id,n.ingredient_id,n.qty,'cancel_return',n.unit_cost,v_after,'order',p_order_id,v_uid,jsonb_build_object('cost_version',1));
   v_restock:=true;
  END LOOP;
 END IF;
 UPDATE public.fnb_orders SET status='cancelled',cancelled_by=v_uid,cancelled_at=clock_timestamp(),cancel_reason=p_reason,updated_at=now() WHERE id=p_order_id;
 UPDATE public.fnb_order_items SET line_status='cancelled' WHERE order_id=p_order_id;
 INSERT INTO public.fnb_order_events(order_id,club_id,action,old_status,new_status,actor,metadata)
 VALUES(p_order_id,o.club_id,'cancelled',o.status,'cancelled',v_uid,jsonb_build_object('reason',p_reason,'reversed_stock',v_restock,'was_shipped',v_any,'cancel_cost_version',1,'returned_cogs_vnd',v_returned,'retained_cogs_vnd',v_kept));
 RETURN jsonb_build_object('status','ok','order_id',p_order_id,'reversed_stock',v_restock,'returned_cogs_vnd',v_returned,'retained_cogs_vnd',v_kept);
END $fn$;
CREATE FUNCTION floor_private.fnb_cancel_cogs_reversal_v1(p_order_id uuid,p_cogs bigint,p_shipped timestamptz) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_meta jsonb;v_returned bigint;
BEGIN
 SELECT metadata INTO v_meta FROM public.fnb_order_events WHERE order_id=p_order_id AND action='cancelled' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF v_meta->>'cancel_cost_version'='1' THEN
  v_returned:=(v_meta->>'returned_cogs_vnd')::bigint;
  IF v_returned IS NULL OR v_returned<0 OR v_returned>p_cogs THEN RAISE EXCEPTION 'fnb_cancel_cost_receipt_invalid';END IF;
  RETURN v_returned;
 END IF;
 -- Legacy history is not backfilled. Actual full inventory returns prove full
 -- reversal even when the order had shipped; otherwise retain legacy basis.
 IF EXISTS(SELECT 1 FROM public.fnb_stock_movements WHERE ref_type='order' AND ref_id=p_order_id AND reason='sale') AND NOT EXISTS(
  SELECT 1 FROM(SELECT ingredient_id,-sum(delta) qty FROM public.fnb_stock_movements WHERE ref_type='order' AND ref_id=p_order_id AND reason='sale' GROUP BY ingredient_id)s
  LEFT JOIN(SELECT ingredient_id,sum(delta) qty FROM public.fnb_stock_movements WHERE ref_type='order' AND ref_id=p_order_id AND reason='cancel_return' GROUP BY ingredient_id)r USING(ingredient_id)
  WHERE coalesce(r.qty,0)<s.qty
 ) THEN RETURN p_cogs;END IF;
 RETURN CASE WHEN p_shipped IS NULL THEN p_cogs ELSE 0 END;
END $fn$;
REVOKE ALL ON FUNCTION floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamptz) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.fnb_get_report(p_from timestamp with time zone, p_to timestamp with time zone, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_all_ids uuid[];
  v_scope   uuid[];
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(array_agg(x), '{}') INTO v_all_ids FROM public.fnb_club_ids(v_uid) x;

  -- [ACCT] read-only report scope: accountant clubs are appended LOCALLY (never via
  -- fnb_club_ids, which also gates F&B write RPCs).
  SELECT v_all_ids || COALESCE(array_agg(ca.club_id), '{}') INTO v_all_ids
  FROM public.club_accountants ca
  WHERE ca.user_id = v_uid AND NOT (ca.club_id = ANY(v_all_ids));

  IF p_club_id IS NOT NULL THEN
    IF NOT (p_club_id = ANY(v_all_ids)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
    v_scope := ARRAY[p_club_id];
  ELSE
    v_scope := v_all_ids;
  END IF;

  WITH
  -- [C] sale: regular paid orders only (comps excluded). [A2] carry table_ref/player_ref.
  sale AS (
    SELECT o.id, o.subtotal_vnd::numeric AS revenue, o.cogs_vnd::numeric AS cogs, o.paid_at AS recog_at,
           o.table_ref, o.player_ref
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  -- [C] refund: regular cancelled orders only (comp cancels excluded). [A2] carry table_ref/player_ref.
  refund AS (
    SELECT o.id, -o.subtotal_vnd::numeric AS revenue,
           -floor_private.fnb_cancel_cogs_reversal_v1(o.id,o.cogs_vnd,o.shipped_at) AS cogs,
           o.cancelled_at AS recog_at,
           o.table_ref, o.player_ref
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  recog AS (
    SELECT id, revenue, cogs, recog_at FROM sale
    UNION ALL
    SELECT id, revenue, cogs, recog_at FROM refund
  ),
  -- [A2] ref recognition = sale ∪ refund carrying the soft refs (so by-table/by-player net refunds
  --      and reconcile to the `revenue`/`cogs` totals).
  ref_recog AS (
    SELECT id, revenue, cogs, table_ref, player_ref FROM sale
    UNION ALL
    SELECT id, revenue, cogs, table_ref, player_ref FROM refund
  ),
  item_recog AS (
    SELECT oi.menu_item_id, oi.name_snapshot,
           oi.qty::numeric AS qty, (oi.unit_price_snapshot * oi.qty)::numeric AS revenue
    FROM public.fnb_order_items oi
    JOIN sale s ON s.id = oi.order_id
    UNION ALL
    SELECT oi.menu_item_id, oi.name_snapshot,
           -oi.qty::numeric AS qty, -(oi.unit_price_snapshot * oi.qty)::numeric AS revenue
    FROM public.fnb_order_items oi
    JOIN public.fnb_orders o ON o.id = oi.order_id
    WHERE o.club_id = ANY(v_scope) AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  itms AS (
    SELECT menu_item_id, name_snapshot, SUM(qty) AS qty, SUM(revenue) AS revenue
    FROM item_recog GROUP BY menu_item_id, name_snapshot
  ),
  -- [A2] revenue/COGS grouped by the soft table ref (NULL → "Khách lẻ").
  by_table AS (
    SELECT rr.table_ref AS ref,
           COALESCE(gt.table_name, 'Khách lẻ') AS name,
           SUM(rr.revenue) AS revenue, SUM(rr.cogs) AS cogs, COUNT(DISTINCT rr.id) AS cnt
    FROM ref_recog rr
    LEFT JOIN public.game_tables gt ON gt.id = rr.table_ref
    GROUP BY rr.table_ref, gt.table_name
  ),
  -- [A2] revenue/COGS grouped by the soft player ref (NULL → "Khách lẻ").
  by_player AS (
    SELECT rr.player_ref AS ref,
           COALESCE(pr.display_name,
                    CASE WHEN rr.player_ref IS NULL THEN 'Khách lẻ' ELSE left(rr.player_ref::text, 6) END) AS name,
           SUM(rr.revenue) AS revenue, SUM(rr.cogs) AS cogs, COUNT(DISTINCT rr.id) AS cnt
    FROM ref_recog rr
    LEFT JOIN public.profiles pr ON pr.user_id = rr.player_ref
    GROUP BY rr.player_ref, pr.display_name
  ),
  status_rows AS (
    SELECT status::text AS status, COUNT(*) AS cnt
    FROM public.fnb_orders
    WHERE club_id = ANY(v_scope) AND created_at BETWEEN p_from AND p_to
    GROUP BY status
  ),
  low AS (
    SELECT id, name, on_hand, low_stock_threshold, stock_unit
    FROM public.fnb_ingredients
    WHERE club_id = ANY(v_scope) AND is_active AND on_hand <= low_stock_threshold
  ),
  daily AS (
    SELECT to_char(recog_at, 'YYYY-MM-DD') AS d, SUM(revenue) AS revenue, SUM(cogs) AS cogs
    FROM recog GROUP BY to_char(recog_at, 'YYYY-MM-DD')
  ),
  -- [C] comp recognition: sale@paid_at (revenue=0, cogs=cogs_vnd) + cancel reversal.
  comp_sale AS (
    SELECT o.id, o.cogs_vnd::numeric AS cogs
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND COALESCE(o.is_comp, false)
      AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN p_from AND p_to
  ),
  comp_cancel AS (
    SELECT o.id,
           -floor_private.fnb_cancel_cogs_reversal_v1(o.id,o.cogs_vnd,o.shipped_at) AS cogs_reversal
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND COALESCE(o.is_comp, false)
      AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'revenue',     (SELECT COALESCE(SUM(revenue), 0) FROM recog),
    'cogs',        (SELECT COALESCE(SUM(cogs), 0) FROM recog),
    'grossProfit', (SELECT COALESCE(SUM(revenue), 0) - COALESCE(SUM(cogs), 0) FROM recog),
    'orderCount',  (SELECT COUNT(*) FROM sale),
    'statusCounts',(SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM status_rows),
    'topItems',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'menuItemId', menu_item_id, 'name', name_snapshot, 'qty', qty, 'revenue', revenue)
                       ORDER BY revenue DESC), '[]'::jsonb)
                    FROM (SELECT * FROM itms WHERE qty <> 0 OR revenue <> 0 ORDER BY revenue DESC LIMIT 10) t),
    'lowStock',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'ingredientId', id, 'name', name, 'onHand', on_hand,
                       'threshold', low_stock_threshold, 'unit', stock_unit)
                       ORDER BY (on_hand - low_stock_threshold)), '[]'::jsonb)
                    FROM low),
    'dailyTrend',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', revenue, 'cogs', cogs)
                       ORDER BY d), '[]'::jsonb)
                    FROM daily),
    -- [C] comp stats: issued this period + net COGS (after any pre-ship cancellations).
    'compCount',   (SELECT COUNT(*) FROM comp_sale),
    'compCogs',    (SELECT COALESCE(SUM(cogs), 0) FROM comp_sale)
                   + (SELECT COALESCE(SUM(cogs_reversal), 0) FROM comp_cancel),
    -- [A2] revenue/COGS by table + by player (reporting-only; reconcile to `revenue`/`cogs`).
    'byTable',     (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'tableRef', ref, 'name', name, 'revenue', revenue, 'cogs', cogs, 'count', cnt)
                       ORDER BY revenue DESC), '[]'::jsonb) FROM by_table),
    'byPlayer',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'playerRef', ref, 'name', name, 'revenue', revenue, 'cogs', cogs, 'count', cnt)
                       ORDER BY revenue DESC), '[]'::jsonb) FROM by_player)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_club_finance_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_super boolean := false;
  v_all_ids uuid[];
  v_club_ids uuid[];
  v_archive_default constant numeric := 199000;
  v_result jsonb;
  v_tour_receipts jsonb;
  v_staff_live jsonb;
  v_staff_year integer := extract(year from now() at time zone 'Asia/Ho_Chi_Minh');
  v_staff_month integer := extract(month from now() at time zone 'Asia/Ho_Chi_Minh');
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.user_roles ur where ur.user_id = v_uid and ur.role = 'super_admin'
  ) into v_super;

  if v_super then
    select coalesce(array_agg(id), '{}') into v_all_ids from public.clubs;
  else
    select coalesce(array_agg(id), '{}') into v_all_ids from public.clubs where owner_id = v_uid;
    -- [ACCT] accountant read scope: clubs where the caller is a club_accountants
    -- member join the owner-scope union (read-only P&L; RPC path only).
    select v_all_ids || coalesce(array_agg(ca.club_id), '{}') into v_all_ids
    from public.club_accountants ca
    where ca.user_id = v_uid and not (ca.club_id = any(v_all_ids));
  end if;

  if p_club_id is not null then
    if not (p_club_id = any(v_all_ids)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_club_ids := array[p_club_id];
  else
    v_club_ids := v_all_ids;
  end if;

  if v_all_ids is null or array_length(v_all_ids, 1) is null then
    return jsonb_build_object(
      'revenue', jsonb_build_object(
        'stakingFees',0,'stakingFixed',0,'stakingPercent',0,'stakingArchive',0,'payoutFees',0,
        'rake',0,'rakeActual',0,'rakeExpected',0,'rakeVariance',0,
        'rakeOnline',0,'rakeOffline',0,'rakeReentry',0,'serviceFee',0,'fnb',0,'total',0),
      'cost', jsonb_build_object(
        'payrollNet',0,'payrollGross',0,'adjustments',0,'ptWagePaid',0,'fnbCogs',0,'compCogs',0,'clubExpenses',0),  -- [C] +compCogs [PT] +ptWagePaid [EXP] +clubExpenses
      'net', 0, 'statusTotals', '{}'::jsonb, 'unpaidTotal', 0, 'reconciledTotal', 0,
      'aging', jsonb_build_object('d0_30',0,'d31_60',0,'d61_90',0,'d90p',0),
      'trend', '[]'::jsonb, 'perPeriod', '[]'::jsonb, 'perClub', '[]'::jsonb, 'clubs', '[]'::jsonb,
      'staffLive',jsonb_build_object('scope','current_outstanding','asOf',now(),'timeZone','Asia/Ho_Chi_Minh',
        'ftPeriod',v_staff_year::text||'-'||lpad(v_staff_month::text,2,'0'),
        'ftProvisionalGross',0,'ftProvisionalNet',0,'ptUnpaidBalance',0)
    );
  end if;

  -- Collect once through the SAME classifier used by live and buy-close.
  select coalesce(jsonb_agg(receipt), '[]'::jsonb) into v_tour_receipts
  from unnest(v_club_ids) cid
  cross join lateral jsonb_array_elements(floor_private.tour_revenue_live_source_v1(cid)->'tours') receipt;

  if exists (select 1 from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.start_time is null and (
      (receipt->>'unavailableBuys')::bigint>0
      or (receipt->>'rake')::numeric<>0 or (receipt->>'serviceFee')::numeric<>0)) then
    raise exception 'finance_report_event_start_unavailable' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.start_time between p_from and p_to and (receipt->>'unavailableBuys')::bigint>0) then
    raise exception 'finance_report_receipt_price_unavailable' using errcode='22023';
  end if;

  with
  acc_clubs as (
    select id, name from public.clubs where id = any(v_all_ids)
  ),
  fee_rows as (
    select d.club_id, to_char(d.created_at, 'YYYY-MM') as ym,
      ( case when d.player_checked_in and coalesce(d.platform_fixed_fee,0) > 0 then coalesce(d.platform_fixed_fee,0) else 0 end ) as fixed_fee,
      ( case when d.player_checked_in and coalesce(d.platform_percent_fee,0) > 0 then coalesce(d.platform_percent_fee,0) else 0 end ) as percent_fee,
      ( case when d.status = 'completed' and coalesce(d.result_prize_vnd,0) > 0
             then least(coalesce(d.platform_archive_fee, v_archive_default), coalesce(d.result_prize_vnd,0)) else 0 end ) as archive_fee
    from public.staking_deals d
    where d.club_id = any(v_club_ids) and d.created_at between p_from and p_to
  ),
  payout_rows as (
    select d.club_id, to_char(pr.created_at, 'YYYY-MM') as ym, coalesce(pr.platform_fee_vnd,0) as fee
    from public.payout_recipients pr
    join public.staking_deals d on d.id = pr.deal_id
    where d.club_id = any(v_club_ids) and pr.created_at between p_from and p_to
  ),
  -- cfg_* column names remain for API compatibility; values are now the
  -- accepted receipt allocation, not a calculation from current tour config.
  rake_cfg as (
    select t.club_id,to_char(t.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') as ym,
      (receipt->>'rakeOnline')::numeric as cfg_online,
      (receipt->>'rakeOffline')::numeric as cfg_offline,
      (receipt->>'rakeReentry')::numeric as cfg_reentry,
      (receipt->>'serviceFee')::numeric as cfg_service,
      (receipt->>'rake')::numeric as actual_sum
    from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.club_id=any(v_club_ids) and t.start_time between p_from and p_to
  ),
  -- [C] fnb_rows: REGULAR paid sales only — comps excluded (NOT COALESCE(o.is_comp,false)).
  --     The same per-club fnb_settings JOIN as before.
  fnb_rows as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           o.subtotal_vnd::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.paid_at is not null
      and o.paid_at between p_from and p_to
      and not coalesce(o.is_comp, false)    -- [C] exclude comps from the regular sales COGS
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           -o.subtotal_vnd::numeric as revenue,
           -floor_private.fnb_cancel_cogs_reversal_v1(o.id,o.cogs_vnd,o.shipped_at) as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
      and not coalesce(o.is_comp, false)    -- [C] exclude comp cancels (handled in fnb_rows_comp)
  ),
  -- [C] fnb_rows_comp: comp-order COGS only, event-time (rev=0 always; cogs=real ingredient cost).
  --     SALE at paid_at; CANCEL reverses COGS if not yet shipped (same rule as regular cancel).
  --     Same per-club gate (fnb_settings.fnb_in_club_net). EMPTY when flag off → golden-diff holds.
  fnb_rows_comp as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           0::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and coalesce(o.is_comp, false)
      and o.paid_at is not null and o.paid_at between p_from and p_to
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           0::numeric as revenue,
           -floor_private.fnb_cancel_cogs_reversal_v1(o.id,o.cogs_vnd,o.shipped_at) as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and coalesce(o.is_comp, false)
      and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
  ),
  rev_all as (
    select club_id, ym, (fixed_fee + percent_fee + archive_fee) as fee from fee_rows
    union all select club_id, ym, fee from payout_rows
    union all select club_id, ym, (cfg_online + cfg_offline + cfg_reentry + cfg_service) as fee from rake_cfg
    union all select club_id, ym, revenue as fee from fnb_rows
    -- [C] fnb_rows_comp.revenue is 0 so omitting from rev_all is equivalent — cleaner.
  ),
  period_agg as (
    select pp.id as period_id, pp.club_id, pp.period_year, pp.period_month, pp.period_end,
      pp.status as period_status, pp.locked_at, pp.approved_at, pp.submitted_at,
      coalesce(sum(dp.net_pay_vnd)   filter (where coalesce(dp.status,'') <> 'excluded'), 0) as net,
      coalesce(sum(dp.gross_pay_vnd) filter (where coalesce(dp.status,'') <> 'excluded'), 0) as gross,
      coalesce(sum(dp.total_adjustments_vnd) filter (where coalesce(dp.status,'') <> 'excluded'), 0) as adj
    from public.payroll_periods pp
    left join public.dealer_payroll dp on dp.period_id = pp.id
    where pp.club_id = any(v_club_ids)
      and pp.period_start <= p_to::date and pp.period_end >= p_from::date
    group by pp.id, pp.club_id, pp.period_year, pp.period_month, pp.period_end,
             pp.status, pp.locked_at, pp.approved_at, pp.submitted_at
  ),
  pay as (
    select distinct on (pr.period_id) pr.period_id, pr.status as pay_status,
      pr.paid_at, pr.reconciled_at, pr.prepared_at
    from public.payment_records pr
    where pr.club_id = any(v_club_ids)
    order by pr.period_id, pr.created_at desc
  ),
  period_eff as (
    select pa.period_id, pa.club_id, pa.period_year, pa.period_month, pa.net, pa.gross, pa.adj,
      case
        when py.reconciled_at is not null or py.pay_status = 'reconciled' then 'reconciled'
        when py.paid_at is not null or py.pay_status = 'paid' then 'paid'
        when py.prepared_at is not null or py.pay_status in ('prepared','payment_prepared') then 'payment_prepared'
        when lower(coalesce(pa.period_status,'')) in
             ('draft','submitted','approved','locked','rejected','payment_prepared','paid','reconciled')
          then lower(pa.period_status)
        else 'other'
      end as eff_status,
      coalesce(py.prepared_at, pa.locked_at, pa.approved_at, pa.submitted_at, pa.period_end::timestamptz) as unpaid_anchor
    from period_agg pa
    left join pay py on py.period_id = pa.period_id
  ),
  -- STAFF FT: read immutable monthly runs, never recalculate settled history.
  -- Same overlap-period convention as dealer monthly payroll, explicit club timezone.
  -- Staff PT monthly runs are summaries of already-paid cash and MUST NOT enter here.
  staff_ft as (
    select r.club_id,r.period_year,r.period_month,r.net_vnd as net,r.gross_vnd as gross,
      0::numeric as adj,
      case when r.status='paid' then 'paid'
           when p.status in ('submitted','approved','rejected') then p.status
           else 'locked' end as eff_status,
      r.locked_at as unpaid_anchor
    from public.staff_salary_runs r
    left join public.staff_salary_periods p on p.club_id=r.club_id
      and p.period_year=r.period_year and p.period_month=r.period_month
    where r.club_id=any(v_club_ids) and r.employment_type='full_time'
      and r.status in ('locked','paid')
      and make_date(r.period_year,r.period_month,1)<=(p_to at time zone 'Asia/Ho_Chi_Minh')::date
      and (make_date(r.period_year,r.period_month,1)+interval '1 month')::date>(p_from at time zone 'Asia/Ho_Chi_Minh')::date
  ),
  payroll_cost as (
    select club_id,period_year,period_month,net,gross,adj,eff_status,unpaid_anchor from period_eff
    union all
    select club_id,period_year,period_month,net,gross,adj,eff_status,unpaid_anchor from staff_ft
  ),
  -- [PT] Option B (restored from 20261028000001 v4): PART-TIME wage payouts are real cash that does
  --      NOT flow through payment_records; summed into payroll cost on a CASH basis (by paid_at,
  --      non-voided). Dropped by the fnb finance rewrites (…000006/…000011/…000013) — restored here.
  pt_pay as (
    select w.club_id, to_char(w.paid_at, 'YYYY-MM') as ym, w.amount_vnd as amt
    from public.dealer_pt_wage_payments w
    where w.club_id = any(v_club_ids)
      and w.voided_at is null
      and w.paid_at between p_from and p_to
    union all
    select w.club_id,to_char(w.paid_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM'),w.amount_vnd
    from public.staff_pt_wage_payments w
    where w.club_id=any(v_club_ids) and w.voided_at is null
      and w.paid_at between p_from and p_to
  ),
  -- [EXP] Club operating expenses (rent/utilities/marketing/…): real cash cost from the append-only
  --       club_expenses ledger. amount_vnd is SIGNED (adjustment rows net out). By incurred_at,
  --       between p_from and p_to — same closed-interval basis as pt_pay / fee_rows.
  club_exp as (
    select e.club_id, to_char(e.incurred_at, 'YYYY-MM') as ym, e.amount_vnd as amt
    from public.club_expenses e
    where e.club_id = any(v_club_ids)
      and e.incurred_at between p_from and p_to
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'stakingFees',    (select coalesce(sum(fixed_fee + percent_fee + archive_fee),0) from fee_rows),
      'stakingFixed',   (select coalesce(sum(fixed_fee),0)   from fee_rows),
      'stakingPercent', (select coalesce(sum(percent_fee),0) from fee_rows),
      'stakingArchive', (select coalesce(sum(archive_fee),0) from fee_rows),
      'payoutFees',     (select coalesce(sum(fee),0) from payout_rows),
      'rake',           (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeActual',     (select coalesce(sum(actual_sum),0) from rake_cfg),
      'rakeExpected',   (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeVariance',   (select coalesce(sum(actual_sum),0) from rake_cfg)
                        - (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeOnline',     (select coalesce(sum(cfg_online),0)  from rake_cfg),
      'rakeOffline',    (select coalesce(sum(cfg_offline),0) from rake_cfg),
      'rakeReentry',    (select coalesce(sum(cfg_reentry),0) from rake_cfg),
      'serviceFee',     (select coalesce(sum(cfg_service),0) from rake_cfg),
      'fnb',            (select coalesce(sum(revenue),0) from fnb_rows),
      'total',          (select coalesce(sum(fee),0) from rev_all)
    ),
    'cost', jsonb_build_object(
      -- [PT] payrollNet INCLUDES PT payouts (Option B). ptWagePaid is the itemized PT sub-total
      --      (already inside payrollNet — do NOT add again in the client).
      'payrollNet',   (select coalesce(sum(net),0)   from payroll_cost) + (select coalesce(sum(amt),0) from pt_pay),
      'payrollGross', (select coalesce(sum(gross),0) from payroll_cost),
      'adjustments',  (select coalesce(sum(adj),0)   from payroll_cost),
      'ptWagePaid',   (select coalesce(sum(amt),0)   from pt_pay),
      'fnbCogs',      (select coalesce(sum(cogs),0)  from fnb_rows),           -- regular sales COGS only
      'compCogs',     (select coalesce(sum(cogs),0)  from fnb_rows_comp),        -- [C] comp COGS (separate line)
      'clubExpenses', (select coalesce(sum(amt),0)   from club_exp)              -- [EXP] operating expenses (rent/utilities/…)
    ),
    -- [C] net deducts BOTH regular COGS and comp COGS (owner decision: comp is a real cost).
    -- [PT] and deducts PT wage payouts (restored).
    'net', (select coalesce(sum(fee),0) from rev_all)
           - (select coalesce(sum(net),0) from payroll_cost)
           - (select coalesce(sum(amt),0) from pt_pay)
           - (select coalesce(sum(cogs),0) from fnb_rows)
           - (select coalesce(sum(cogs),0) from fnb_rows_comp)
           - (select coalesce(sum(amt),0) from club_exp),   -- [EXP] deduct operating expenses
    'statusTotals', (
      select coalesce(jsonb_object_agg(eff_status, total), '{}'::jsonb)
      from (select eff_status, sum(net) as total from payroll_cost group by eff_status) s
    ),
    'unpaidTotal', (select coalesce(sum(net),0) from payroll_cost
                    where eff_status in ('submitted','approved','locked','payment_prepared')),
    'reconciledTotal', (select coalesce(sum(net),0) from payroll_cost where eff_status = 'reconciled'),
    'aging', (
      select jsonb_build_object(
        'd0_30',  coalesce(sum(net) filter (where days <= 30), 0),
        'd31_60', coalesce(sum(net) filter (where days > 30 and days <= 60), 0),
        'd61_90', coalesce(sum(net) filter (where days > 60 and days <= 90), 0),
        'd90p',   coalesce(sum(net) filter (where days > 90), 0)
      )
      from (
        select net, greatest(0, floor(extract(epoch from (now() - unpaid_anchor)) / 86400))::int as days
        from payroll_cost
        where eff_status in ('submitted','approved','locked','payment_prepared')
      ) a
    ),
    'trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', to_char(to_date(ym, 'YYYY-MM'), 'MM/YY'), 'revenue', rev_v, 'cost', cost_v
      ) order by ym), '[]'::jsonb)
      from (
        select m.ym,
          coalesce((select sum(fee) from rev_all r where r.ym = m.ym), 0) as rev_v,
          -- [C] cost_v now includes both regular and comp COGS
          coalesce((select sum(net) from payroll_cost pe
                    where to_char(make_date(pe.period_year, pe.period_month, 1), 'YYYY-MM') = m.ym), 0)
            + coalesce((select sum(amt) from pt_pay pp where pp.ym = m.ym), 0)              -- [PT]
            + coalesce((select sum(cogs) from fnb_rows f where f.ym = m.ym), 0)
            + coalesce((select sum(cogs) from fnb_rows_comp fc where fc.ym = m.ym), 0)
            + coalesce((select sum(amt) from club_exp ce where ce.ym = m.ym), 0) as cost_v  -- [EXP]
        from (
          select ym from rev_all
          union select to_char(make_date(period_year, period_month, 1), 'YYYY-MM') as ym from payroll_cost
          union select ym from pt_pay           -- [PT] PT months into the spine
          union select ym from fnb_rows
          union select ym from fnb_rows_comp    -- [C] comp months into the spine
          union select ym from club_exp         -- [EXP] expense months into the spine
        ) m
      ) t
    ),
    'perPeriod', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pe.period_id, 'clubId', pe.club_id,
        'clubName', coalesce((select name from acc_clubs ac where ac.id = pe.club_id), '—'),
        'periodKey', lpad(pe.period_month::text, 2, '0') || '/' || pe.period_year::text,
        'gross', pe.gross, 'net', pe.net, 'status', pe.eff_status
      ) order by pe.period_year desc, pe.period_month desc), '[]'::jsonb)
      from period_eff pe
    ),
    'perClub', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'clubId', cid, 'name', cname, 'revenue', rev_v, 'cost', cost_v, 'net', rev_v - cost_v
      ) order by (rev_v - cost_v) desc), '[]'::jsonb)
      from (
        select ac.id as cid, ac.name as cname,
          coalesce((select sum(fee) from rev_all r where r.club_id = ac.id), 0) as rev_v,
          coalesce((select sum(net) from payroll_cost pe where pe.club_id = ac.id), 0)
            + coalesce((select sum(amt) from pt_pay pp where pp.club_id = ac.id), 0)                    -- [PT]
            + coalesce((select sum(cogs) from fnb_rows f where f.club_id = ac.id), 0)
            + coalesce((select sum(cogs) from fnb_rows_comp fc where fc.club_id = ac.id), 0)
            + coalesce((select sum(amt) from club_exp ce where ce.club_id = ac.id), 0) as cost_v        -- [EXP]
        from acc_clubs ac
        where ac.id = any(v_club_ids)
      ) pc
      where rev_v <> 0 or cost_v <> 0
    ),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from acc_clubs)
  ) into v_result;

  -- Current outstanding is an explicitly separate clock/scope from the selected
  -- historical P&L range. Reuse canonical salary rules; never fabricate a second
  -- payroll calculator or recalculate/overwrite saved monthly runs.
  with preview_clubs as (
    select cid from unnest(v_club_ids) cid
    where not exists(select 1 from public.staff_salary_periods p
      where p.club_id=cid and p.period_year=v_staff_year and p.period_month=v_staff_month)
      and not exists(select 1 from public.staff_salary_runs r
        where r.club_id=cid and r.period_year=v_staff_year and r.period_month=v_staff_month
          and r.status<>'voided')
  ), ft_preview as (
    select row_data from preview_clubs c
    cross join lateral jsonb_array_elements(public.get_staff_salary_month(c.cid,v_staff_year,v_staff_month)->'staff') row_data
    where row_data->>'employment_type'='full_time'
  ), pt_live as (
    select public._staff_pt_wage_balance(s.id) as balance
    from public.staff s where s.club_id=any(v_club_ids)
      and s.employment_type='part_time' and s.status='active' and s.deleted_at is null
  )
  select jsonb_build_object(
    'scope','current_outstanding','asOf',now(),'timeZone','Asia/Ho_Chi_Minh',
    'ftPeriod',v_staff_year::text||'-'||lpad(v_staff_month::text,2,'0'),
    'ftProvisionalGross',(select coalesce(sum((row_data->>'gross_vnd')::bigint),0) from ft_preview),
    'ftProvisionalNet',(select coalesce(sum((row_data->>'net_vnd')::bigint),0) from ft_preview),
    'ptUnpaidBalance',(select coalesce(sum((balance->>'balance_vnd')::bigint),0) from pt_live)
  ) into v_staff_live;

  return v_result||jsonb_build_object('staffLive',v_staff_live);
end;
$function$;
