-- LOCAL/SOURCE ONLY. CLI candidate20261016224624, forward slot133.
-- Cancellation serializes with apply under the final tournament lock. Retain
-- immutable plans/receipts; never erase seating that committed before cancel.
-- Recovery: forward revoke cancel/apply together; preserve decision evidence.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_user<>'postgres' OR to_regclass('private.multi_day_initial_draw_cancellations_v1') IS NOT NULL OR
   md5(replace(pg_get_functiondef('public.multi_day_apply_initial_draw_v1(uuid,uuid)'::regprocedure),chr(13),''))
     <>'07c00b8542aa2b97eadead02bac8056d' THEN
   RAISE EXCEPTION 'multiday133_catalog_drift'; END IF;
END $$;
CREATE TABLE private.multi_day_initial_draw_cancellations_v1(
 plan_id uuid PRIMARY KEY REFERENCES private.multi_day_initial_draw_plans_v1(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,request_id)
);
ALTER TABLE private.multi_day_initial_draw_cancellations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_initial_draw_cancellations_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_initial_draw_cancel_immutable_v1 BEFORE UPDATE OR DELETE
ON private.multi_day_initial_draw_cancellations_v1 FOR EACH ROW
EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
DO $patch$
DECLARE definition text:=replace(pg_get_functiondef('public.multi_day_apply_initial_draw_v1(uuid,uuid)'::regprocedure),chr(13),'');
 needle text:=$old$ -- Same ordering as Floor. Lock all physical rows first, then exact sessions,$old$;
BEGIN
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'multiday133_anchor_drift'; END IF;
 EXECUTE replace(definition,needle,$new$ IF EXISTS(SELECT 1 FROM private.multi_day_initial_draw_cancellations_v1 WHERE plan_id=p_plan_id) THEN
   RAISE EXCEPTION 'multi_day_initial_draw_cancelled' USING ERRCODE='23514'; END IF;
 -- Same ordering as Floor. Lock all physical rows first, then exact sessions,$new$);
END $patch$;
CREATE FUNCTION public.multi_day_cancel_initial_draw_v1(p_plan_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); plan private.multi_day_initial_draw_plans_v1;
 prior private.multi_day_initial_draw_cancellations_v1; application jsonb; receipt jsonb; snapshot jsonb;
BEGIN
 IF actor IS NULL OR p_plan_id IS NULL OR p_request_id IS NULL THEN
   RAISE EXCEPTION 'multi_day_initial_draw_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO plan FROM private.multi_day_initial_draw_plans_v1 WHERE id=p_plan_id;
 IF NOT FOUND OR plan.actor_id<>actor THEN
   RAISE EXCEPTION 'multi_day_initial_draw_actor_denied' USING ERRCODE='42501'; END IF;
 snapshot:=public.multi_day_final_roster_v1(plan.event_id);
 PERFORM 1 FROM public.tournaments WHERE id=plan.final_tournament_id FOR UPDATE;
 SELECT * INTO prior FROM private.multi_day_initial_draw_cancellations_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.plan_id<>p_plan_id THEN RAISE EXCEPTION 'multi_day_initial_draw_request_conflict' USING ERRCODE='23505'; END IF;
   RETURN prior.receipt||jsonb_build_object('idempotent',true);
 END IF;
 SELECT a.receipt INTO application FROM private.multi_day_initial_draw_applications_v1 a WHERE a.plan_id=p_plan_id;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'state','APPLIED','planId',p_plan_id,
   'eventId',plan.event_id,'requestId',p_request_id,'application',application); END IF;
 SELECT * INTO prior FROM private.multi_day_initial_draw_cancellations_v1 WHERE plan_id=p_plan_id;
 IF FOUND THEN RETURN prior.receipt||jsonb_build_object('idempotent',true); END IF;
 receipt:=jsonb_build_object('ok',true,'state','CANCELLED','planId',p_plan_id,'eventId',plan.event_id,
   'actorId',actor,'requestId',p_request_id,'cancelledAt',now(),'idempotent',false);
 INSERT INTO private.multi_day_initial_draw_cancellations_v1(plan_id,actor_id,request_id,receipt)
 VALUES(p_plan_id,actor,p_request_id,receipt);
 RETURN receipt;
END $$;
CREATE FUNCTION public.multi_day_get_initial_draw_resolution_v1(p_event_id uuid,p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; application jsonb; cancellation jsonb;
BEGIN
 snapshot:=public.multi_day_final_roster_v1(p_event_id);
 IF NOT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_plans_v1 p
   WHERE p.id=p_plan_id AND p.event_id=p_event_id AND p.actor_id=auth.uid()) THEN
   RAISE EXCEPTION 'multi_day_initial_draw_actor_denied' USING ERRCODE='42501'; END IF;
 SELECT a.receipt INTO application FROM private.multi_day_initial_draw_applications_v1 a WHERE a.plan_id=p_plan_id;
 SELECT c.receipt INTO cancellation FROM private.multi_day_initial_draw_cancellations_v1 c WHERE c.plan_id=p_plan_id;
 RETURN jsonb_build_object('ok',true,'application',application,'cancellation',cancellation);
END $$;
ALTER FUNCTION public.multi_day_cancel_initial_draw_v1(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.multi_day_get_initial_draw_resolution_v1(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.multi_day_cancel_initial_draw_v1(uuid,uuid),
 public.multi_day_get_initial_draw_resolution_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_cancel_initial_draw_v1(uuid,uuid),
 public.multi_day_get_initial_draw_resolution_v1(uuid,uuid) TO authenticated;
COMMIT;
