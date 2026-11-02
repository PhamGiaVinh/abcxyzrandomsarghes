-- LOCAL/SOURCE ONLY. CLI candidate20261016223236, forward slot131.
-- Immutable initial D2 preview. Does NOT write entry, seat, cash or chip facts.
-- Recovery: revoke plan creation in a new migration, retain immutable previews.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_user<>'postgres' OR to_regclass('private.multi_day_initial_draw_plans_v1') IS NOT NULL OR
    to_regprocedure('public.multi_day_final_roster_v1(uuid)') IS NULL THEN
   RAISE EXCEPTION 'multiday131_catalog_drift'; END IF;
END $$;
CREATE TABLE private.multi_day_initial_draw_plans_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.multi_day_qualification_locks_v1(event_id),
 final_tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{32}$'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_id)
);
ALTER TABLE private.multi_day_initial_draw_plans_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_initial_draw_plans_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_initial_draw_plan_immutable_v1 BEFORE UPDATE OR DELETE
ON private.multi_day_initial_draw_plans_v1 FOR EACH ROW
EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE FUNCTION public.multi_day_plan_initial_draw_v1(
 p_event_id uuid,p_tournament_table_ids uuid[],p_expected_source_hash text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid:=auth.uid(); snapshot jsonb; selected jsonb; assignments jsonb;
 ids uuid[]; final_id uuid; plan_id uuid:=gen_random_uuid(); fingerprint text;
 prior private.multi_day_initial_draw_plans_v1; receipt jsonb; player_count integer;
BEGIN
 IF actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL OR
    p_expected_source_hash IS NULL OR p_expected_source_hash!~'^[a-f0-9]{32}$' OR
    p_tournament_table_ids IS NULL OR cardinality(p_tournament_table_ids) NOT BETWEEN 1 AND 50 OR
    EXISTS(SELECT 1 FROM unnest(p_tournament_table_ids) id WHERE id IS NULL) THEN
   RAISE EXCEPTION 'multi_day_initial_draw_invalid' USING ERRCODE='22023'; END IF;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM unnest(p_tournament_table_ids) id;
 IF cardinality(ids)<>cardinality(p_tournament_table_ids) THEN
   RAISE EXCEPTION 'multi_day_initial_draw_duplicate_table' USING ERRCODE='22023'; END IF;
 snapshot:=public.multi_day_final_roster_v1(p_event_id); -- scoped authorization
 final_id:=(snapshot->>'finalTournamentId')::uuid;
 PERFORM 1 FROM public.tournaments WHERE id=final_id FOR UPDATE;
 fingerprint:=md5(jsonb_build_object('event',p_event_id,'tables',ids,'source',p_expected_source_hash)::text);
 SELECT * INTO prior FROM private.multi_day_initial_draw_plans_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.payload_hash<>fingerprint OR prior.event_id<>p_event_id THEN
     RAISE EXCEPTION 'multi_day_initial_draw_request_conflict' USING ERRCODE='23505'; END IF;
   RETURN prior.receipt||jsonb_build_object('idempotent',true);
 END IF;
 snapshot:=public.multi_day_final_roster_v1(p_event_id);
 IF NOT (snapshot->>'releaseEnabled')::boolean THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=final_id AND
   (t.status IN('completed','cancelled') OR t.registration_closed_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'multi_day_final_seating_closed' USING ERRCODE='23514'; END IF;
 IF snapshot->>'sourceHash'<>p_expected_source_hash THEN
   RAISE EXCEPTION 'multi_day_initial_draw_source_stale' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'players') p WHERE p->>'state'='BLOCKED') THEN
   RAISE EXCEPTION 'multi_day_initial_draw_participation_blocked' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO player_count FROM jsonb_array_elements(snapshot->'players') p WHERE p->>'state'='UNSEATED';
 IF player_count=0 THEN RAISE EXCEPTION 'multi_day_initial_draw_no_unseated' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(t ORDER BY t->>'tournamentTableId'),'[]'::jsonb) INTO selected
 FROM jsonb_array_elements(snapshot->'tables') t WHERE (t->>'tournamentTableId')::uuid=ANY(ids);
 IF jsonb_array_length(selected)<>cardinality(ids) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(selected) t WHERE t->>'blocker' IS NOT NULL) THEN
   RAISE EXCEPTION 'multi_day_initial_draw_table_blocked' USING ERRCODE='23514'; END IF;
 WITH shuffled AS MATERIALIZED(
   SELECT p,row_number() OVER(ORDER BY random()) ordinal
   FROM jsonb_array_elements(snapshot->'players') p WHERE p->>'state'='UNSEATED'
 ), slots AS (
   SELECT t,seat,row_number() OVER(ORDER BY seat,(t->>'tableNumber')::integer,t->>'tournamentTableId') ordinal
   FROM jsonb_array_elements(selected) t CROSS JOIN LATERAL generate_series(1,(t->>'capacity')::integer) seat
   WHERE NOT (t->'occupiedSeats')@>jsonb_build_array(seat) AND NOT (t->'lockedSeats')@>jsonb_build_array(seat)
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
    'participationId',p->>'participationId','playerId',p->>'playerId','name',p->>'name',
    'stack',(p->>'stack')::bigint,'seedRevision',(p->>'seedRevision')::integer,
    'tournamentTableId',t->>'tournamentTableId','tableSessionId',t->>'tableSessionId',
    'physicalTableId',t->>'physicalTableId','tableNumber',(t->>'tableNumber')::integer,
    'seatNumber',seat,'requestId',gen_random_uuid()) ORDER BY shuffled.ordinal),'[]'::jsonb)
 INTO assignments FROM shuffled JOIN slots USING(ordinal);
 IF jsonb_array_length(assignments)<>player_count THEN
   RAISE EXCEPTION 'multi_day_initial_draw_insufficient_capacity' USING ERRCODE='23514'; END IF;
 receipt:=jsonb_build_object('ok',true,'state','PLANNED','planId',plan_id,'eventId',p_event_id,
   'finalTournamentId',final_id,'sourceHash',p_expected_source_hash,'selectedTables',selected,
   'assignments',assignments,'idempotent',false);
 INSERT INTO private.multi_day_initial_draw_plans_v1(id,event_id,final_tournament_id,actor_id,request_id,payload_hash,receipt)
 VALUES(plan_id,p_event_id,final_id,actor,p_request_id,fingerprint,receipt);
 RETURN receipt;
END $$;

CREATE FUNCTION public.multi_day_get_initial_draw_plan_v1(p_event_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; receipt jsonb;
BEGIN
 snapshot:=public.multi_day_final_roster_v1(p_event_id);
 SELECT p.receipt INTO receipt FROM private.multi_day_initial_draw_plans_v1 p
 WHERE p.event_id=p_event_id AND p.actor_id=auth.uid() AND p.request_id=p_request_id;
 RETURN jsonb_build_object('ok',true,'plan',receipt);
END $$;
ALTER FUNCTION public.multi_day_plan_initial_draw_v1(uuid,uuid[],text,uuid) OWNER TO postgres;
ALTER FUNCTION public.multi_day_get_initial_draw_plan_v1(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.multi_day_plan_initial_draw_v1(uuid,uuid[],text,uuid),
 public.multi_day_get_initial_draw_plan_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_plan_initial_draw_v1(uuid,uuid[],text,uuid),
 public.multi_day_get_initial_draw_plan_v1(uuid,uuid) TO authenticated;
COMMIT;
