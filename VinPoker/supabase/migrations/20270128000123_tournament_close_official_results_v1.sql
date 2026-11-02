-- SOURCE/LOCAL TEST ONLY. CLI generated20261016152408, forward source slot123.
-- Finalize captured results atomically with a NEW close report. Reuse the
-- existing ranking algorithm; no payout, financial totals or rounding change.
-- Compensation: restore the recorded blocker definition, then drop this new
-- trigger/functions in a reviewed forward migration;
-- retain official places, close reports, cash and immutable historical audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'official123_reviewed_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public.close_tournament(uuid,text)'::regprocedure),chr(13),''))<>'5b007d2e26b9e735db6c88fb58034982'
 OR md5(replace(pg_get_functiondef('public.finalize_tournament_results(uuid)'::regprocedure),chr(13),''))<>'05f8be81b2c5414bf35d745c54133cdb'
 OR md5(replace(pg_get_functiondef('floor_private.felt_tournament_close_blockers_v1(uuid)'::regprocedure),chr(13),''))<>'1c77052afa745bcbe1e3496c5779c024'
 THEN RAISE EXCEPTION 'official123_dependency_drift'; END IF;
 IF to_regprocedure('floor_private.felt_finalize_official_results_at_close_v1()') IS NOT NULL
 OR to_regprocedure('floor_private.felt_official_results_close_status_v1(uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_close_report'::regclass AND tgname='trg_felt_official_results_close_v1')
 THEN RAISE EXCEPTION 'official123_catalog_collision'; END IF;
END;
$preflight$;
-- One read-only classifier is shared by readiness and the locked writer. It
-- never ranks, changes chips or publishes a partial result.
CREATE FUNCTION floor_private.felt_official_results_close_status_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH ranked AS (
  SELECT e.*,row_number() OVER(PARTITION BY COALESCE(e.member_id::text,e.player_id::text)
   ORDER BY e.entry_no DESC NULLS LAST,e.created_at DESC) AS rn
  FROM public.tournament_entries e WHERE e.tournament_id=p_tournament_id
 ), finals AS (SELECT * FROM ranked WHERE rn=1), facts AS (
  SELECT count(*) AS field_count,count(finished_place) AS ranked_count,count(DISTINCT finished_place) AS distinct_places,
   min(finished_place) AS first_place,max(finished_place) AS last_place,
   count(*) FILTER(WHERE COALESCE(status,'')<>'busted') AS survivors,
   COALESCE(bool_and(finished_place=1) FILTER(WHERE COALESCE(status,'')<>'busted'),false) AS winner_placed,
   COALESCE(bool_and(finished_place>1) FILTER(WHERE status='busted'),true) AS busted_placed,
   count(*) FILTER(WHERE status='busted' AND (bust_order IS NULL OR bust_order<1)) AS missing_orders,
   count(*) FILTER(WHERE status='busted') AS busted_count,count(DISTINCT bust_order) FILTER(WHERE status='busted') AS distinct_orders,
   (SELECT count(*) FROM public.tournament_entries e WHERE e.tournament_id=p_tournament_id AND e.finished_place IS NOT NULL) AS all_ranked
  FROM finals
 ) SELECT jsonb_build_object('field',field_count,'status',CASE
  WHEN NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_tournament_id) THEN 'official_results_tournament_missing'
  WHEN NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.club_settings s ON s.club_id=t.club_id WHERE t.id=p_tournament_id AND s.player_history_enabled) THEN 'disabled'
  WHEN field_count=0 THEN 'empty'
  WHEN survivors<>1 THEN 'official_results_not_finished'
  WHEN all_ranked>0 THEN CASE WHEN ranked_count=field_count AND all_ranked=field_count AND distinct_places=field_count
   AND first_place=1 AND last_place=field_count AND winner_placed AND busted_placed THEN 'preserved' ELSE 'official_results_incomplete' END
  WHEN missing_orders>0 OR distinct_orders<>busted_count OR busted_count=0 THEN 'official_results_evidence_missing'
  ELSE 'ready_to_finalize' END) FROM facts;
$$;
ALTER FUNCTION floor_private.felt_official_results_close_status_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.felt_official_results_close_status_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.felt_finalize_official_results_at_close_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid:=auth.uid(); tour public.tournaments%ROWTYPE; phase integer; state jsonb; verdict text; result jsonb;
BEGIN
 IF actor IS NULL OR NEW.closed_by IS DISTINCT FROM actor THEN
  RAISE EXCEPTION 'official_results_actor_not_allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=NEW.tournament_id FOR UPDATE;
 IF NOT FOUND OR tour.club_id IS DISTINCT FROM NEW.club_id OR NOT EXISTS(
  SELECT 1 FROM public.clubs c LEFT JOIN public.club_cashiers cc ON cc.club_id=c.id AND cc.user_id=actor
  WHERE c.id=tour.club_id AND (c.owner_id=actor OR cc.user_id IS NOT NULL))
 THEN RAISE EXCEPTION 'official_results_actor_not_allowed' USING ERRCODE='42501'; END IF;
 -- Existing Floor/close writers already lock tournament before entries. Keep
 -- that order and fence all participation rows while finalizing/checking.
 PERFORM 1 FROM public.tournament_entries e WHERE e.tournament_id=tour.id ORDER BY e.id FOR UPDATE;
 FOR phase IN 1..2 LOOP
  state:=floor_private.felt_official_results_close_status_v1(tour.id);verdict:=state->>'status';
  IF verdict IN ('disabled','empty') THEN RETURN NEW; END IF;
  IF verdict='preserved' THEN
   -- Complete existing results are immutable here; never run the recomputing
   -- legacy finalizer over them or silently patch a partial legacy result.
   NEW.detail:=COALESCE(NEW.detail,'{}'::jsonb)||jsonb_build_object('official_results',
    jsonb_build_object('version',1,'status',CASE WHEN phase=1 THEN 'preserved' ELSE 'finalized' END,'field',state->'field'));
   RETURN NEW;
  END IF;
  IF verdict IS DISTINCT FROM 'ready_to_finalize' OR phase=2 THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE=COALESCE(verdict,'official_results_finalization_failed'); END IF;
  result:=public.finalize_tournament_results(tour.id);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'official_results_finalization_failed' USING ERRCODE='P0001',DETAIL=COALESCE(result::text,'null'); END IF;
 END LOOP;
 RAISE EXCEPTION 'official_results_finalization_failed' USING ERRCODE='P0001';
END;
$$;
ALTER FUNCTION floor_private.felt_finalize_official_results_at_close_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.felt_finalize_official_results_at_close_v1() FROM PUBLIC,anon,authenticated,service_role;
DO $readiness$
DECLARE definition text; anchor text:='  RETURN v_blockers;';
BEGIN
 SELECT replace(pg_get_functiondef('floor_private.felt_tournament_close_blockers_v1(uuid)'::regprocedure),chr(13),'') INTO definition;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'official123_readiness_anchor_drift'; END IF;
 definition:=replace(definition,anchor,$body$  IF v_blockers='[]'::jsonb THEN
    DECLARE state jsonb:=floor_private.felt_official_results_close_status_v1(p_tournament_id);
    BEGIN
      IF COALESCE(state->>'status','') NOT IN ('disabled','empty','preserved','ready_to_finalize') THEN
        v_blockers:=v_blockers||jsonb_build_array(COALESCE(state->>'status','official_results_finalization_failed'));
      END IF;
    END;
  END IF;
  RETURN v_blockers;$body$);
 EXECUTE definition;
END;
$readiness$;
-- Name sorts after the existing felt guard: active-seat/session/assignment
-- blockers are checked before any ranking work. Both share the same transaction.
CREATE TRIGGER trg_felt_official_results_close_v1 BEFORE INSERT ON public.tournament_close_report
FOR EACH ROW EXECUTE FUNCTION floor_private.felt_finalize_official_results_at_close_v1();
COMMIT;
