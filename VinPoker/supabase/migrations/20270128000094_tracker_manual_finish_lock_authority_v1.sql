-- CLI candidate20261015205122; local forward94 reservation only, not live approval.
-- Authenticated manual Finish must hold the hand lock at the serialized write.
-- Voice service delegation retains its reviewed assignment/session/state checks.
-- Recovery: reviewed forward restore of captured pre-apply function definition;
-- never rewind completed hands, chip projections, outcomes or audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE signature regprocedure:='public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure;
 definition text; anchor text:=E'  PERFORM 1 FROM public.hand_players hp WHERE hp.hand_id = v_hand.id FOR UPDATE;';
 before_metadata jsonb; after_metadata jsonb;
BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_get_functiondef(signature),chr(13),''))<>'16006fec6f3b9274581de471a9dc296a' THEN
  RAISE EXCEPTION 'manual_finish94_baseline_drift'; END IF;
 SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'acl',proacl::text,'config',proconfig,
 'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text) INTO before_metadata FROM pg_proc WHERE oid=signature;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'manual_finish94_hand_lock_anchor_drift'; END IF;
 definition:=replace(definition,anchor,$guard$
  -- v_hand was selected FOR UPDATE. Another actor cannot take over between
  -- this check and completion. Do not bypass manual ownership by club role.
  IF NOT v_service_voice_call AND v_hand.locked_by_user_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok',false,'error','lock_not_held');
  END IF;
$guard$||anchor);
 EXECUTE definition;
 SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'acl',proacl::text,'config',proconfig,
 'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text) INTO after_metadata FROM pg_proc WHERE oid=signature;
 IF before_metadata IS DISTINCT FROM after_metadata OR replace(pg_get_functiondef(signature),chr(13),'') IS DISTINCT FROM definition THEN
  RAISE EXCEPTION 'manual_finish94_postcheck_drift'; END IF;
END;
$migration$;
COMMIT;
