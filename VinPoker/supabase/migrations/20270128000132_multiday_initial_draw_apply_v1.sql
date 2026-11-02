-- LOCAL/SOURCE ONLY. CLI candidate20261016223554, forward slot132.
-- One transaction applies an immutable initial D2 plan using canonical seat RPC.
-- Recovery: suspend apply in a forward migration, preserve seats and receipts;
-- any reversal needs audited domain compensation, never delete historical facts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_user<>'postgres' OR to_regclass('private.multi_day_initial_draw_applications_v1') IS NOT NULL OR
    to_regprocedure('public.multi_day_plan_initial_draw_v1(uuid,uuid[],text,uuid)') IS NULL THEN
   RAISE EXCEPTION 'multiday132_catalog_drift'; END IF;
END $$;
CREATE TABLE private.multi_day_initial_draw_applications_v1(
 plan_id uuid PRIMARY KEY REFERENCES private.multi_day_initial_draw_plans_v1(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL,
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 applied_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_id)
);
ALTER TABLE private.multi_day_initial_draw_applications_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_initial_draw_applications_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_initial_draw_application_immutable_v1 BEFORE UPDATE OR DELETE
ON private.multi_day_initial_draw_applications_v1 FOR EACH ROW
EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE FUNCTION public.multi_day_apply_initial_draw_v1(p_plan_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); plan private.multi_day_initial_draw_plans_v1;
 prior private.multi_day_initial_draw_applications_v1; snapshot jsonb; selected jsonb;
 assignment jsonb; result jsonb; results jsonb:='[]'::jsonb; receipt jsonb;
BEGIN
 IF actor IS NULL OR p_plan_id IS NULL OR p_request_id IS NULL THEN
   RAISE EXCEPTION 'multi_day_initial_draw_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO plan FROM private.multi_day_initial_draw_plans_v1 WHERE id=p_plan_id;
 IF NOT FOUND OR plan.actor_id IS DISTINCT FROM actor THEN
   RAISE EXCEPTION 'multi_day_initial_draw_actor_denied' USING ERRCODE='42501'; END IF;
 snapshot:=public.multi_day_final_roster_v1(plan.event_id); -- reauthorize replay
 PERFORM 1 FROM public.tournaments WHERE id=plan.final_tournament_id FOR UPDATE;
 SELECT * INTO prior FROM private.multi_day_initial_draw_applications_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.plan_id<>p_plan_id THEN
     RAISE EXCEPTION 'multi_day_initial_draw_request_conflict' USING ERRCODE='23505'; END IF;
   RETURN prior.receipt||jsonb_build_object('idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=p_plan_id) THEN
   RAISE EXCEPTION 'multi_day_initial_draw_already_applied_use_receipt' USING ERRCODE='23505'; END IF;
 -- Same ordering as Floor. Lock all physical rows first, then exact sessions,
 -- then logical assignments. Never infer a new session for a reused table.
 PERFORM 1 FROM public.game_tables g WHERE g.id IN(
   SELECT (t->>'physicalTableId')::uuid FROM jsonb_array_elements(plan.receipt->'selectedTables') t)
 ORDER BY g.id FOR UPDATE;
 PERFORM 1 FROM public.table_sessions s WHERE s.id IN(
   SELECT (t->>'tableSessionId')::uuid FROM jsonb_array_elements(plan.receipt->'selectedTables') t)
 ORDER BY s.id FOR UPDATE;
 PERFORM 1 FROM public.tournament_tables t WHERE t.id IN(
   SELECT (x->>'tournamentTableId')::uuid FROM jsonb_array_elements(plan.receipt->'selectedTables') x)
 ORDER BY t.id FOR UPDATE;
 snapshot:=public.multi_day_final_roster_v1(plan.event_id);
 IF NOT (snapshot->>'releaseEnabled')::boolean THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501'; END IF;
 IF snapshot->>'sourceHash' IS DISTINCT FROM plan.receipt->>'sourceHash' THEN
   RAISE EXCEPTION 'multi_day_initial_draw_source_stale' USING ERRCODE='40001'; END IF;
 SELECT coalesce(jsonb_agg(t ORDER BY t->>'tournamentTableId'),'[]'::jsonb) INTO selected
 FROM jsonb_array_elements(snapshot->'tables') t WHERE t->>'tournamentTableId' IN(
   SELECT x->>'tournamentTableId' FROM jsonb_array_elements(plan.receipt->'selectedTables') x);
 IF selected IS DISTINCT FROM plan.receipt->'selectedTables' THEN
   RAISE EXCEPTION 'multi_day_initial_draw_table_stale' USING ERRCODE='40001'; END IF;
 FOR assignment IN SELECT x FROM jsonb_array_elements(plan.receipt->'assignments') x LOOP
   result:=public.multi_day_seat_final_v1(plan.event_id,(assignment->>'playerId')::uuid,
     (assignment->>'tournamentTableId')::uuid,(assignment->>'seatNumber')::integer,
     (assignment->>'seedRevision')::integer,(assignment->>'requestId')::uuid);
   IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'state' IS DISTINCT FROM 'SEATED' OR
      (result->>'seedStack')::bigint IS DISTINCT FROM (assignment->>'stack')::bigint OR
      result->>'participationId' IS DISTINCT FROM assignment->>'participationId' THEN
     RAISE EXCEPTION 'multi_day_initial_draw_seat_result_invalid' USING ERRCODE='23514'; END IF;
   results:=results||jsonb_build_array(result);
 END LOOP;
 IF jsonb_array_length(results)=0 THEN
   RAISE EXCEPTION 'multi_day_initial_draw_empty_plan' USING ERRCODE='23514'; END IF;
 UPDATE public.table_sessions s SET revision=s.revision+1 WHERE s.id IN(
   SELECT (t->>'tableSessionId')::uuid FROM jsonb_array_elements(selected) t);
 UPDATE public.tournament_tables t SET floor_control_revision=t.floor_control_revision+1 WHERE t.id IN(
   SELECT (x->>'tournamentTableId')::uuid FROM jsonb_array_elements(selected) x);
 receipt:=plan.receipt||jsonb_build_object('state','APPLIED','requestId',p_request_id,
   'appliedAt',now(),'seatReceipts',results,'idempotent',false);
 INSERT INTO private.multi_day_initial_draw_applications_v1(plan_id,actor_id,request_id,receipt)
 VALUES(p_plan_id,actor,p_request_id,receipt);
 RETURN receipt;
END $$;

CREATE FUNCTION public.multi_day_get_initial_draw_application_v1(p_event_id uuid,p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; receipt jsonb;
BEGIN
 snapshot:=public.multi_day_final_roster_v1(p_event_id);
 SELECT a.receipt INTO receipt FROM private.multi_day_initial_draw_applications_v1 a
 JOIN private.multi_day_initial_draw_plans_v1 p ON p.id=a.plan_id
 WHERE p.event_id=p_event_id AND a.plan_id=p_plan_id AND a.actor_id=auth.uid();
 RETURN jsonb_build_object('ok',true,'application',receipt);
END $$;
ALTER FUNCTION public.multi_day_apply_initial_draw_v1(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.multi_day_get_initial_draw_application_v1(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.multi_day_apply_initial_draw_v1(uuid,uuid),
 public.multi_day_get_initial_draw_application_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_apply_initial_draw_v1(uuid,uuid),
 public.multi_day_get_initial_draw_application_v1(uuid,uuid) TO authenticated;
COMMIT;
