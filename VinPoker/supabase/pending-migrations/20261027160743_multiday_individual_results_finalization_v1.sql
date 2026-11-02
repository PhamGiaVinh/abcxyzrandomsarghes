-- LOCAL candidate; requires individual rank package20261027155124.
-- Exact baseline only. Execute in an explicit guarded transaction.
DO $$ BEGIN
 IF to_regclass('private.multi_day_individual_results_v1') IS NULL
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.finalize_tournament_results(uuid)'::regprocedure))
   IS DISTINCT FROM '6dbe0cca5584570defa8c07acc5693c5'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure))
   IS DISTINCT FROM '8c4d35c69aba350d436f6f9ae43ff29e'
 THEN RAISE EXCEPTION 'individual_finalization_dependency_drift';END IF;
END $$;

CREATE FUNCTION private.multi_day_individual_close_state_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE event_id uuid;s jsonb;ranking jsonb;field integer;state text;
BEGIN
 SELECT t.event_id INTO event_id FROM public.tournaments t WHERE t.id=p_tournament_id;
 s:=private.multi_day_individual_rank_source_v1(event_id);ranking:=s->'ranking';field:=(s->>'field')::integer;
 IF (ranking->>'survivors')::integer<>1 THEN state:='official_results_not_finished';
 ELSIF (ranking->>'activeHand')::boolean OR (ranking->>'evidencePending')::boolean THEN state:='ranking_hand_evidence_pending';
 ELSIF (SELECT count(*) FROM private.multi_day_individual_results_v1 WHERE tournament_id=p_tournament_id)<>field-1
 OR EXISTS(SELECT 1 FROM public.tournament_entries e LEFT JOIN private.multi_day_individual_results_v1 f ON f.entry_id=e.id
  WHERE e.tournament_id=p_tournament_id AND ((e.status='busted' AND (f.entry_id IS NULL OR f.player_id<>e.player_id
   OR f.entry_no<>e.entry_no OR f.tournament_id<>e.tournament_id OR f.finished_place>field))
   OR (coalesce(e.status,'')<>'busted' AND f.entry_id IS NOT NULL)))
 THEN state:='individual_results_confirmation_required';
 ELSIF EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=p_tournament_id AND finished_place IS NOT NULL) THEN
  IF EXISTS(SELECT 1 FROM public.tournament_entries e LEFT JOIN private.multi_day_individual_results_v1 f ON f.entry_id=e.id
    WHERE e.tournament_id=p_tournament_id AND e.finished_place IS DISTINCT FROM CASE WHEN e.status='busted' THEN f.finished_place ELSE 1 END)
  THEN state:='official_results_incomplete';ELSE state:='preserved';END IF;
 ELSE state:='ready_to_finalize';END IF;
 RETURN jsonb_build_object('field',field,'status',state,'eventId',event_id);
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_close_state_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.finalize_multi_day_individual_results_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state jsonb;changed integer;
BEGIN
 -- Called only after canonical finalizer acquired tournament lock and checked
 -- authority. Do not acquire event after tournament: confirmation locks event
 -- then tournament. Tournament/entry locks serialize both without a cycle.
 PERFORM 1 FROM public.tournament_entries WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 state:=private.multi_day_individual_close_state_v1(p_tournament_id);
 IF state->>'status'='preserved' THEN
  RETURN jsonb_build_object('ok',true,'outcome','preserved','field',state->'field','survivors',1);
 END IF;
 IF state->>'status'<>'ready_to_finalize' THEN RETURN jsonb_build_object('ok',false,'error',state->>'status');END IF;
 UPDATE public.tournament_entries e SET finished_place=f.finished_place
 FROM private.multi_day_individual_results_v1 f WHERE f.entry_id=e.id AND e.tournament_id=p_tournament_id
  AND e.finished_place IS DISTINCT FROM f.finished_place;
 GET DIAGNOSTICS changed=ROW_COUNT;
 UPDATE public.tournament_entries SET finished_place=1 WHERE tournament_id=p_tournament_id
  AND coalesce(status,'')<>'busted' AND finished_place IS DISTINCT FROM 1;
 IF private.multi_day_individual_close_state_v1(p_tournament_id)->>'status'<>'preserved'
 THEN RAISE EXCEPTION 'individual_results_finalization_mismatch';END IF;
 RETURN jsonb_build_object('ok',true,'field',state->'field','places_set',changed+1,'survivors',1,'individual_results',true);
END $$;
REVOKE ALL ON FUNCTION private.finalize_multi_day_individual_results_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE fn regprocedure;definition text;acl aclitem[];anchor text;
BEGIN
 fn:='public.finalize_tournament_results(uuid)'::regprocedure;
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 anchor:='  -- Guard (post-audit P2):';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_finalizer_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,$new$  IF EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1 WHERE tournament_id=p_tournament_id) THEN
    RETURN private.finalize_multi_day_individual_results_v1(p_tournament_id);
  END IF;
$new$||anchor);
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_finalizer_acl_drift';END IF;
 fn:='floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure;
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 anchor:='  WHEN all_ranked>0 THEN';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_close_status_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,$new$  WHEN EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1 WHERE tournament_id=p_tournament_id)
    THEN private.multi_day_individual_close_state_v1(p_tournament_id)->>'status'
$new$||anchor);
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_close_status_acl_drift';END IF;
END $patch$;
