-- CLI candidate20261016083936; local catalog112, NOT RELEASED.
-- Atomic cash intent/receipt foundation; preserves the reviewed price, money
-- ledger and seating core. UI durable journal must ship before acceptance.
-- Apply only after quiescing/draining legacy cash RPC transactions. Restore by
-- reviewed forward change; NEVER delete movements, receipts or cancellation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_get_functiondef(
  'public.cashier_record_cash_buyin_v1(uuid,bigint,uuid)'::regprocedure),chr(13),''))<>'13580e9dadd30cce072c016ef0da6cda'
 OR to_regprocedure('public.resolve_cashier_cash_buyin_intent_v1(jsonb,text)') IS NOT NULL
 OR to_regprocedure('floor_private.cashier_cash_existing_intent_v1(uuid,uuid,uuid,uuid,bigint,uuid)') IS NOT NULL
 OR to_regprocedure('floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)') IS NULL
 OR to_regprocedure('floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)') IS NULL THEN
  RAISE EXCEPTION 'cash_intent112_dependency_or_catalog_drift'; END IF;
 IF has_function_privilege('anon','public.cashier_record_cash_buyin_v1(uuid,bigint,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.cashier_record_cash_buyin_v1(uuid,bigint,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.cashier_record_cash_buyin_v1(uuid,bigint,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'cash_intent112_core_acl_drift'; END IF;
END $$;

-- Shared by legacy and exact-intent writers: cancellation must fence BOTH.
-- Legacy registration-first locking is preserved; mutex acquisition never waits.
CREATE FUNCTION floor_private.cashier_cash_existing_intent_v1(
 p_actor uuid,p_club uuid,p_tour uuid,p_registration uuid,p_amount bigint,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE receipt record; intent jsonb;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('cashier-cash-v2:'||p_club::text||':'||p_request::text,0)) THEN
  RETURN jsonb_build_object('ok',false,'error','cash_intent_busy'); END IF;
 intent:=jsonb_build_object('actor_id',p_actor,'club_id',p_club,'tournament_id',p_tour,
  'registration_id',p_registration,'amount',p_amount,'request_id',p_request);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(p_actor,'cashier_cash_buyin_v2',p_request);
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF receipt.request_fingerprint::jsonb IS DISTINCT FROM intent THEN
  RETURN jsonb_build_object('ok',false,'error','request_id_reused'); END IF;
 RETURN receipt.result->'result';
END $$;
REVOKE ALL ON FUNCTION floor_private.cashier_cash_existing_intent_v1(uuid,uuid,uuid,uuid,bigint,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE target regprocedure:='public.cashier_record_cash_buyin_v1(uuid,bigint,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 anchor text:='  SELECT * INTO v_prior FROM public.cashier_buyin_movements';
BEGIN
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 OR length(definition)-length(replace(definition,'v_prior.amount <> p_amount THEN',''))<>length('v_prior.amount <> p_amount THEN') THEN
  RAISE EXCEPTION 'cash_intent112_core_anchor_drift'; END IF;
 definition:=replace(definition,anchor,
  E'  v_result:=floor_private.cashier_cash_existing_intent_v1(v_actor,v_reg.club_id,v_reg.tournament_id,v_reg.id,p_amount,p_request_id);\n  IF v_result IS NOT NULL THEN RETURN v_result; END IF;\n'||anchor);
 definition:=replace(definition,'v_prior.amount <> p_amount THEN',
  'v_prior.amount <> p_amount OR v_prior.actor_id IS DISTINCT FROM v_actor THEN');
 EXECUTE definition;
END;
$patch$;

CREATE FUNCTION public.resolve_cashier_cash_buyin_intent_v1(p_intent jsonb,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='250ms' AS $$
<<cash_intent>>
DECLARE actor uuid:=auth.uid(); club uuid; tour uuid; registration uuid; request_id uuid; amount bigint;
 canonical jsonb; receipt record; movement public.cashier_buyin_movements%ROWTYPE;
 reg public.tournament_registrations%ROWTYPE; result jsonb; outcome text;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 IF p_action IS NULL OR p_action NOT IN ('read','record','cancel') OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_cash_intent'); END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_intent))<>6 OR EXISTS(
  SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN
  ('actor_id','club_id','tournament_id','registration_id','amount','request_id'))
 OR jsonb_typeof(p_intent->'amount') IS DISTINCT FROM 'number' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_cash_intent'); END IF;
 IF actor IS DISTINCT FROM (p_intent->>'actor_id')::uuid THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 club:=(p_intent->>'club_id')::uuid; tour:=(p_intent->>'tournament_id')::uuid;
 registration:=(p_intent->>'registration_id')::uuid; request_id:=(p_intent->>'request_id')::uuid;
 IF club IS NULL OR tour IS NULL OR registration IS NULL OR request_id IS NULL
 OR (p_intent->>'amount')::numeric NOT BETWEEN 1 AND 9007199254740991
 OR trunc((p_intent->>'amount')::numeric)<>(p_intent->>'amount')::numeric THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_cash_intent'); END IF;
 amount:=(p_intent->>'amount')::bigint;
 canonical:=jsonb_build_object('actor_id',actor,'club_id',club,'tournament_id',tour,
  'registration_id',registration,'amount',amount,'request_id',request_id);
 IF public.is_club_cashier(actor,club) IS NOT TRUE THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 -- Read never locks or writes. A missing receipt is UNKNOWN, not rollback.
 IF p_action<>'read' AND NOT pg_try_advisory_xact_lock(hashtextextended('cashier-cash-v2:'||club::text||':'||request_id::text,0)) THEN
  RETURN jsonb_build_object('ok',false,'error','cash_intent_busy'); END IF;
 IF p_action='read' THEN
  SELECT * INTO reg FROM public.tournament_registrations WHERE id=registration;
 ELSE
  SELECT * INTO reg FROM public.tournament_registrations WHERE id=registration FOR UPDATE NOWAIT;
 END IF;
 IF reg.id IS NULL OR reg.club_id IS DISTINCT FROM club OR reg.tournament_id IS DISTINCT FROM tour THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'cashier_cash_buyin_v2',request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint::jsonb IS DISTINCT FROM canonical THEN
   RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN receipt.result;
 END IF;
 SELECT * INTO movement FROM public.cashier_buyin_movements
 WHERE club_id=club AND idempotency_key='cash:'||request_id::text;
 IF FOUND THEN
  IF movement.actor_id IS DISTINCT FROM actor OR movement.tournament_id IS DISTINCT FROM tour
   OR movement.registration_id IS DISTINCT FROM registration OR movement.amount IS DISTINCT FROM amount
   OR movement.applied_amount IS DISTINCT FROM amount OR movement.method<>'cash' OR movement.direction<>'in' OR movement.purpose<>'buyin' THEN
   RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
  result:=jsonb_build_object('ok',true,'already_recorded',true,'movement_id',movement.id);
  outcome:='recorded';
 ELSIF p_action='read' THEN
  RETURN jsonb_build_object('ok',true,'status','unknown','intent',canonical);
 ELSIF p_action='cancel' THEN
  result:=jsonb_build_object('ok',false,'error','cash_intent_cancelled'); outcome:='cancelled';
 ELSE
  result:=public.cashier_record_cash_buyin_v1(registration,amount,request_id);
  IF jsonb_typeof(result->'ok') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_cash_core_outcome'; END IF;
  outcome:=CASE WHEN result->>'ok'='true' THEN 'recorded' ELSE 'rejected' END;
  IF outcome='recorded' AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
   WHERE m.club_id=club AND m.registration_id=registration AND m.tournament_id=tour AND m.actor_id=actor
   AND m.idempotency_key='cash:'||request_id::text AND m.amount=cash_intent.amount AND m.applied_amount=cash_intent.amount
   AND m.method='cash' AND m.direction='in' AND m.purpose='buyin') THEN
   RAISE EXCEPTION 'cash_record_without_movement'; END IF;
 END IF;
 result:=jsonb_build_object('ok',true,'status',outcome,'intent',canonical,'result',result);
 IF p_action<>'read' THEN
  PERFORM floor_private.floor_table_v3_save_receipt(actor,'cashier_cash_buyin_v2',request_id,canonical::text,result);
 END IF;
 RETURN result;
EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'error','cash_intent_busy');
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('ok',false,'error','invalid_cash_intent');
END $$;
REVOKE ALL ON FUNCTION public.resolve_cashier_cash_buyin_intent_v1(jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_cashier_cash_buyin_intent_v1(jsonb,text) TO authenticated;
COMMIT;
