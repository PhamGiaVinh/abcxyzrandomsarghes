-- CLI candidate20261019072917, local179. NOT RELEASED.
-- Persist the current outgoing attendance when an operator creates slot0.
-- No historical backfill, rest/payroll change or worker guard weakening.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $migration$
DECLARE
 target regprocedure:='public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid)'::regprocedure;
 definition text; before_metadata jsonb; after_metadata jsonb; old_insert text;
BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'e0be4b77eb58641cfaf42f0d6e17ddb8'
 OR md5(replace(pg_get_functiondef('public.worker_execute_rotation_slot_v1(uuid,integer,uuid,uuid,integer,uuid,timestamptz,integer,boolean,integer)'::regprocedure),chr(13),''))<>'095f0741b34d185ac49053dd12331f80'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000179') THEN
  RAISE EXCEPTION 'operator_next179_precondition_drift';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,
  'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_metadata FROM pg_proc WHERE oid=target;
 IF before_metadata->>'owner'<>'postgres' OR before_metadata->>'definer'<>'true'
 OR before_metadata->>'acl'<>'{postgres=X/postgres,authenticated=X/postgres}'
 OR before_metadata->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb THEN
  RAISE EXCEPTION 'operator_next179_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 old_insert:=$old$  IF plan_count=0 THEN
   INSERT INTO public.dealer_rotation_schedule(club_id,table_id,assignment_id,slot_index,planned_relief_at,plan_run_id,solver_version)
   VALUES(scope_id,physical_id,p_assignment_id,0,assignment_row.swing_due_at,p_request_id,'operator_next_intent_v1')$old$;
 IF array_length(string_to_array(definition,old_insert),1)<>2 THEN RAISE EXCEPTION 'operator_next179_insert_anchor_drift';END IF;
 definition:=replace(definition,old_insert,$new$  IF plan_count=0 THEN
   -- The locked assignment is authoritative. A missing outgoing identity is
   -- repair-required, never an executable automatic handoff plan.
   IF assignment_row.attendance_id IS NULL THEN RETURN jsonb_build_object('outcome','plan_requires_repair');END IF;
   INSERT INTO public.dealer_rotation_schedule(club_id,table_id,assignment_id,out_attendance_id,slot_index,planned_relief_at,plan_run_id,solver_version)
   VALUES(scope_id,physical_id,p_assignment_id,assignment_row.attendance_id,0,assignment_row.swing_due_at,p_request_id,'operator_next_intent_v1')$new$);
 EXECUTE definition;
 IF replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition THEN RAISE EXCEPTION 'operator_next179_body_postcheck';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,
  'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_metadata FROM pg_proc WHERE oid=target;
 IF before_metadata IS DISTINCT FROM after_metadata THEN RAISE EXCEPTION 'operator_next179_metadata_postcheck';END IF;
END;
$migration$;
COMMIT;
