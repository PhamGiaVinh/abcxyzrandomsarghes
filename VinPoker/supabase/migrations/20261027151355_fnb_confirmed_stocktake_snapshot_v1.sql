-- LOCAL candidate. CLI-generated timestamp retained in pending package because
-- repository future-dated migrations make automatic chronological replay unsafe.
-- Apply only after the exact existing commit/line-writer dependencies below.
DO $guard$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.fnb_commit_stocktake(uuid)'::regprocedure))
      IS DISTINCT FROM '40f139b94c96dbc0baff179f5c401faa'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.fnb_set_stocktake_line(uuid,uuid,numeric)'::regprocedure))
      IS DISTINCT FROM '53a7eb7f6d22acd262afcce688e3d9f9'
 OR to_regprocedure('public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)') IS NOT NULL
 THEN RAISE EXCEPTION 'stocktake_confirmed_dependency_drift_or_collision'; END IF;
END;
$guard$;

CREATE FUNCTION public.fnb_commit_stocktake_confirmed_v1(
 p_stocktake_id uuid, p_expected_counts jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $body$
DECLARE
 actor uuid:=auth.uid();
 session_row public.fnb_stocktakes%ROWTYPE;
 item record;
 normalized jsonb:='{}'::jsonb;
 actual_counts jsonb;
 ingredient_key uuid;
 quantity numeric;
 reply jsonb;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
 -- The parent lock is shared with both canonical line updates and legacy commit.
 SELECT * INTO session_row FROM public.fnb_stocktakes WHERE id=p_stocktake_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','STOCKTAKE_NOT_FOUND'); END IF;
 IF NOT public.is_club_owner(actor,session_row.club_id) THEN
  RETURN jsonb_build_object('error','Forbidden');
 END IF;
 IF session_row.status NOT IN ('open','committed') THEN
  RETURN jsonb_build_object('error','BAD_STATE','status',session_row.status);
 END IF;
 IF p_expected_counts IS NULL OR jsonb_typeof(p_expected_counts)<>'object' THEN
  RETURN jsonb_build_object('error','INVALID_EXPECTED_COUNTS');
 END IF;
 FOR item IN SELECT key,value FROM jsonb_each(p_expected_counts) LOOP
  IF jsonb_typeof(item.value) NOT IN ('number','string') THEN
   RETURN jsonb_build_object('error','INVALID_EXPECTED_COUNTS');
  END IF;
  BEGIN
   ingredient_key:=item.key::uuid;
   IF length(item.value#>>'{}')>128 OR btrim(item.value#>>'{}')='' THEN
    RETURN jsonb_build_object('error','INVALID_EXPECTED_COUNTS');
   END IF;
   quantity:=(item.value#>>'{}')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   RETURN jsonb_build_object('error','INVALID_EXPECTED_COUNTS');
  END;
  IF quantity<0 OR quantity::text IN ('NaN','Infinity','-Infinity')
   OR normalized ? ingredient_key::text THEN
   RETURN jsonb_build_object('error','INVALID_EXPECTED_COUNTS');
  END IF;
  normalized:=normalized||jsonb_build_object(ingredient_key::text,quantity);
 END LOOP;
 -- Retain row locks as well as the canonical parent lock through adjustment.
 PERFORM 1 FROM public.fnb_stocktake_lines
  WHERE stocktake_id=p_stocktake_id ORDER BY ingredient_id FOR UPDATE;
 SELECT coalesce(jsonb_object_agg(ingredient_id::text,counted_qty),'{}'::jsonb)
 INTO actual_counts FROM public.fnb_stocktake_lines WHERE stocktake_id=p_stocktake_id;
 IF actual_counts IS DISTINCT FROM normalized THEN
  RETURN jsonb_build_object('error','STOCKTAKE_COUNTS_CHANGED');
 END IF;
 -- Preserve the existing current-stock delta, cost, movement and replay formula.
 reply:=public.fnb_commit_stocktake(p_stocktake_id);
 IF reply->>'status'='ok' THEN
  RETURN reply||jsonb_build_object('counts_confirmed',true,
   'stocktake_id',p_stocktake_id,'confirmed_counts',normalized);
 END IF;
 RETURN reply;
END;
$body$;
-- Same owner-only authority as the canonical command; never inherit PUBLIC execute.
REVOKE ALL ON FUNCTION public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb) TO authenticated;
