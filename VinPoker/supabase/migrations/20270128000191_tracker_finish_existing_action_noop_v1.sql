-- Finish's prior action-conflict validation and hand row lock prove these rows
-- identical. Do not re-insert them: BEFORE INSERT budget triggers run before
-- ON CONFLICT DO NOTHING and would otherwise count their contribution twice.
-- No trigger/ACL weakening, action rewrite, or historical repair.
-- Recovery: restore captured predecessor function through a reviewed forward
-- migration; retain completed hands and receipts. Never delete/replay ledger.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE target regprocedure:='public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure;
 definition text; before_meta jsonb; after_meta jsonb;
 anchor text:=E'  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP\n    INSERT INTO public.hand_actions (';
 replacement text:=E'  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP\n    -- Existing rows were checked against the complete payload under the hand lock.\n    IF EXISTS (SELECT 1 FROM public.hand_actions existing\n      WHERE existing.hand_id=v_hand.id\n        AND existing.action_order=(v_action->>''action_order'')::integer) THEN\n      CONTINUE;\n    END IF;\n    INSERT INTO public.hand_actions (';
BEGIN
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000191')
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'c27453912f2d503d87e0be18412dc92e'
 THEN RAISE EXCEPTION 'tracker_finish191_baseline_drift_or_collision';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_meta FROM pg_proc WHERE oid=target;
 IF before_meta->>'owner'<>'postgres' OR before_meta->>'definer'<>'true'
 OR before_meta->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb
 OR before_meta->>'acl'<>'{postgres=X/postgres}' THEN RAISE EXCEPTION 'tracker_finish191_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF array_length(string_to_array(definition,anchor),1)<>2
 OR position('RETURN jsonb_build_object(''ok'', false, ''error'', ''action_conflict'')' in definition)=0
 THEN RAISE EXCEPTION 'tracker_finish191_anchor_drift';END IF;
 definition:=replace(definition,anchor,replacement);
 EXECUTE definition;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_meta FROM pg_proc WHERE oid=target;
 IF before_meta IS DISTINCT FROM after_meta OR replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition
 THEN RAISE EXCEPTION 'tracker_finish191_postcheck';END IF;
END;
$patch$;
COMMIT;
