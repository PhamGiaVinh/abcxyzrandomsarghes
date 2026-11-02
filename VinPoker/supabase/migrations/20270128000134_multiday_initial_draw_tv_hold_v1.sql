-- LOCAL/SOURCE ONLY. CLI candidate20261016225924, forward slot134.
-- Initial D2 participates in existing redraw hold/continue. Never fabricate
-- historical moves or expose qualification/payment/participant IDs publicly.
-- Recovery: suspend new initial apply, forward restore pinned functions; resolve
-- any active holds via existing continue RPC before removing publication.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 writer regprocedure:='public.multi_day_apply_initial_draw_v1(uuid,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(writer),chr(13),'');
 projection text:=replace(pg_get_functiondef('public.get_public_tournament_redraw_v1(uuid)'::regprocedure),chr(13),'');
 needle text:=$old$ receipt:=plan.receipt||jsonb_build_object('state','APPLIED','requestId',p_request_id,$old$;
BEGIN
 IF current_user<>'postgres' OR md5(definition)<>'b9b9b4faaa8a78f2d7981bd132604aea' OR
    md5(projection)<>'4f9aabd19e87e0502240ec07736c8505' OR
    md5(replace(pg_get_functiondef('floor_private.floor_redraw_apply_clock_hold_v1()'::regprocedure),chr(13),''))<>'75b608294137d956bf04c3a7cd5f5b6a' OR
    to_regprocedure('floor_private.standard_public_redraw_v1(uuid)') IS NOT NULL THEN
   RAISE EXCEPTION 'multiday134_catalog_drift'; END IF;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'multiday134_anchor_drift'; END IF;
 -- Keep ordinary redraw semantics and authorization byte-for-byte in a
 -- non-exposed helper. CREATE OR REPLACE retains public reader grants below.
 EXECUTE replace(projection,'public.get_public_tournament_redraw_v1(','floor_private.standard_public_redraw_v1(');
 EXECUTE replace(definition,needle,$new$ INSERT INTO public.tournament_redraw_batches(id,tournament_id,target_max_seats,
   target_game_table_ids,snapshot_fingerprint,planned_by)
 SELECT p_plan_id,plan.final_tournament_id,max((t->>'capacity')::integer),
   array_agg((t->>'physicalTableId')::uuid ORDER BY t->>'physicalTableId'),plan.receipt->>'sourceHash',actor
 FROM jsonb_array_elements(selected) t;
 -- The existing transition trigger freezes the clock and fences these exact
 -- sessions. No source-seat rows belong to an initial D2 seating.
 UPDATE public.tournament_redraw_batches SET status='applied',applied_by=actor,applied_at=now()
 WHERE id=p_plan_id;
 receipt:=plan.receipt||jsonb_build_object('state','APPLIED','requestId',p_request_id,$new$);
END $patch$;
REVOKE ALL ON FUNCTION floor_private.standard_public_redraw_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE initial jsonb;
BEGIN
 SELECT jsonb_build_object('kind','initial_d2','batch_id',b.id,'redraw_revision',b.redraw_revision,
   'tournament_name',t.name,'target_max_seats',b.target_max_seats,'applied_at',b.presentation_started_at,
   'moves',jsonb_agg(jsonb_build_object('ordinal',m.ordinal,'player_name',m.value->>'name',
     'from_table_number',NULL,'from_seat_number',NULL,
     'to_table_number',(m.value->>'tableNumber')::integer,'to_seat_number',(m.value->>'seatNumber')::integer)
     ORDER BY m.ordinal)) INTO initial
 FROM public.tournament_redraw_batches b
 JOIN private.multi_day_initial_draw_plans_v1 p ON p.id=b.id AND p.final_tournament_id=b.tournament_id
 JOIN private.multi_day_initial_draw_applications_v1 a ON a.plan_id=p.id
 JOIN public.tournaments t ON t.id=b.tournament_id
 CROSS JOIN LATERAL jsonb_array_elements(p.receipt->'assignments') WITH ORDINALITY m(value,ordinal)
 WHERE b.tournament_id=p_tournament_id AND b.status='applied' AND b.hold_completed_at IS NULL
   AND t.deleted_at IS NULL AND EXISTS(SELECT 1 FROM public.table_sessions s
     WHERE s.tournament_id=b.tournament_id AND s.redraw_hold_batch_id=b.id AND s.closed_at IS NULL)
 GROUP BY b.id,t.name ORDER BY b.presentation_started_at DESC,b.id DESC LIMIT 1;
 IF initial IS NOT NULL THEN RETURN initial; END IF;
 RETURN floor_private.standard_public_redraw_v1(p_tournament_id);
END $$;
ALTER FUNCTION public.get_public_tournament_redraw_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_tournament_redraw_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_redraw_v1(uuid) TO anon,authenticated;
COMMIT;
