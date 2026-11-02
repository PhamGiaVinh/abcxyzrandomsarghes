-- CLI scaffold20261026013640; forward slot296 checked unused26Oct2026.
-- LOCAL CANDIDATE ONLY. Owner chose explicit Floor order for same-hand busts.
-- Do not install durably until native/recovery/concurrency/browser qualification.
BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.finalize_tournament_results(uuid)'::regprocedure),chr(13),''))<>'df45256a89b7a56fe6d7630803ff241a'
 OR md5(replace(pg_get_functiondef('floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure),chr(13),''))<>'906391392ced28d9ac94220e3ab42e2a'
 OR to_regclass('floor_private.tournament_ranking_reviews296') IS NOT NULL
 OR to_regprocedure('floor_private.tournament_ranking_source296(uuid)') IS NOT NULL
 OR to_regprocedure('public.get_tournament_ranking_review_v1(uuid)') IS NOT NULL
 OR to_regprocedure('public.confirm_tournament_ranking_review_v1(uuid,text,uuid[],uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.get_tournament_ranking_review_receipt_v1(uuid,uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000296')
 THEN RAISE EXCEPTION 'ranking296_dependency_drift_or_collision'; END IF;
END $$;

CREATE TABLE floor_private.tournament_ranking_reviews296(
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{32}$'),
 ordered_entry_ids uuid[] NOT NULL CHECK(cardinality(ordered_entry_ids)>1),
 actor_id uuid NOT NULL,request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tournament_id,source_hash),UNIQUE(actor_id,request_id)
);
ALTER TABLE floor_private.tournament_ranking_reviews296 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tournament_ranking_reviews296 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.ranking_review_immutable296() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'ranking_review_immutable'; END $$;
REVOKE ALL ON FUNCTION floor_private.ranking_review_immutable296() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ranking_review_immutable296 BEFORE UPDATE OR DELETE ON floor_private.tournament_ranking_reviews296
 FOR EACH ROW EXECUTE FUNCTION floor_private.ranking_review_immutable296();

-- Read current final bullets and exact hand evidence; no timestamp grouping.
-- Names are presentation only and excluded from the intent source hash.
CREATE FUNCTION floor_private.tournament_ranking_source296(p_tournament_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH latest AS (
  SELECT e.*,row_number() OVER(PARTITION BY coalesce(e.member_id::text,e.player_id::text)
   ORDER BY e.entry_no DESC NULLS LAST,e.created_at DESC,e.id) rn
  FROM public.tournament_entries e WHERE e.tournament_id=p_tournament_id
 ), finals AS (SELECT * FROM latest WHERE rn=1), evidence AS (
  SELECT x.id,x.hand_id,x.player_id,x.entry_number,h.source_revision,h.status,h.is_voided
  FROM public.tournament_eliminations x JOIN finals f ON f.player_id=x.player_id AND f.entry_no=x.entry_number
   AND f.status='busted'
  JOIN public.tournament_hands h ON h.id=x.hand_id AND h.tournament_id=x.tournament_id
  WHERE x.tournament_id=p_tournament_id
 ), groups AS (SELECT hand_id FROM evidence GROUP BY hand_id HAVING count(DISTINCT (player_id,entry_number))>1),
 facts AS (
  SELECT count(*) field,count(*) FILTER(WHERE coalesce(status,'')<>'busted') survivors,
   count(*) FILTER(WHERE status='busted' AND (bust_order IS NULL OR bust_order<1)) missing_orders,
   coalesce(jsonb_agg(jsonb_build_object('entryId',id,'playerId',player_id,'entryNo',entry_no,
    'memberId',member_id,'status',status,'bustOrder',bust_order) ORDER BY id),'[]'::jsonb) entries
  FROM finals
 ), source AS (
  SELECT jsonb_build_object('tournamentId',p_tournament_id,'entries',facts.entries,
   'hands',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.hand_id,e.id),'[]'::jsonb) FROM evidence e)) body
  FROM facts
 ) SELECT jsonb_build_object('tournamentId',p_tournament_id,'sourceHash',md5(source.body::text),
  'field',facts.field,'survivors',facts.survivors,'missingOrders',facts.missing_orders,
  'requiresReview',EXISTS(SELECT 1 FROM groups),
  'activeHand',EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=p_tournament_id
   AND status='in_progress' AND NOT coalesce(is_voided,false)),
  'evidencePending',EXISTS(SELECT 1 FROM evidence WHERE status<>'completed' OR coalesce(is_voided,false))
   OR EXISTS(SELECT 1 FROM evidence WHERE NOT coalesce(is_voided,false)
    GROUP BY player_id,entry_number HAVING count(DISTINCT hand_id)>1)
   OR EXISTS(SELECT 1 FROM public.hand_players hp
    JOIN public.tournament_hands h ON h.id=hp.hand_id AND h.tournament_id=p_tournament_id
    JOIN finals f ON f.player_id=hp.player_id AND f.entry_no=hp.entry_number AND f.status='busted'
    WHERE hp.is_eliminated AND NOT coalesce(h.is_voided,false)
     AND NOT EXISTS(SELECT 1 FROM public.tournament_eliminations x WHERE x.tournament_id=p_tournament_id
      AND x.hand_id=h.id AND x.player_id=hp.player_id AND x.entry_number=hp.entry_number)),
  'hasOfficial',EXISTS(SELECT 1 FROM latest WHERE finished_place IS NOT NULL),
  'entries',(SELECT coalesce(jsonb_agg(jsonb_build_object('entryId',f.id,'playerId',f.player_id,'entryNo',f.entry_no,
   'name',coalesce(nullif(p.display_name,''),'Player '||left(f.player_id::text,8)),
   'status',f.status,'bustOrder',f.bust_order,'finishedPlace',f.finished_place)
   ORDER BY CASE WHEN coalesce(f.status,'')<>'busted' THEN 0 ELSE 1 END,f.bust_order DESC NULLS LAST,f.id),'[]'::jsonb)
   FROM finals f LEFT JOIN public.profiles p ON p.user_id=f.player_id),
  'simultaneousHands',(SELECT coalesce(jsonb_agg(hand_id ORDER BY hand_id),'[]'::jsonb) FROM groups),
  'simultaneousGroups',(SELECT coalesce(jsonb_agg(jsonb_build_object('handId',g.hand_id,
   'entryIds',(SELECT jsonb_agg(DISTINCT f.id ORDER BY f.id) FROM evidence e JOIN finals f
    ON f.player_id=e.player_id AND f.entry_no=e.entry_number WHERE e.hand_id=g.hand_id)) ORDER BY g.hand_id),'[]'::jsonb) FROM groups g))
 FROM facts,source;
$$;
REVOKE ALL ON FUNCTION floor_private.tournament_ranking_source296(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_tournament_ranking_review_v1(p_tournament_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;s jsonb;r floor_private.tournament_ranking_reviews296%ROWTYPE;
BEGIN
 SELECT club_id INTO club FROM public.tournaments WHERE id=p_tournament_id;
 IF actor IS NULL OR club IS NULL OR NOT(public.is_club_cashier(actor,club) OR public.is_club_admin(actor,club)
  OR public.is_club_owner(actor,club) OR public.has_role(actor,'super_admin'::public.app_role))
 THEN RAISE EXCEPTION 'actor_not_allowed' USING ERRCODE='42501';END IF;
 s:=floor_private.tournament_ranking_source296(p_tournament_id);
 SELECT * INTO r FROM floor_private.tournament_ranking_reviews296 WHERE tournament_id=p_tournament_id AND source_hash=s->>'sourceHash';
 RETURN jsonb_build_object('ok',true,'source',s,'review',CASE WHEN r.request_id IS NULL THEN NULL ELSE to_jsonb(r) END);
END $$;
REVOKE ALL ON FUNCTION public.get_tournament_ranking_review_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_ranking_review_v1(uuid) TO authenticated;

-- Read the retained request even after its source becomes stale. Never retry
-- the confirmation writer merely to discover whether a response was lost.
CREATE FUNCTION public.get_tournament_ranking_review_receipt_v1(p_tournament_id uuid,p_request_id uuid,p_expected_actor_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();current_state jsonb;r floor_private.tournament_ranking_reviews296%ROWTYPE;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'ranking_review_actor_or_request_required' USING ERRCODE='42501';END IF;
 current_state:=public.get_tournament_ranking_review_v1(p_tournament_id);
 SELECT * INTO r FROM floor_private.tournament_ranking_reviews296 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND AND r.tournament_id IS DISTINCT FROM p_tournament_id THEN RAISE EXCEPTION 'ranking_receipt_scope_conflict'; END IF;
 RETURN jsonb_build_object('ok',true,'outcome',CASE WHEN r.request_id IS NULL THEN 'not_found' ELSE 'recorded' END,
  'review',CASE WHEN r.request_id IS NULL THEN NULL ELSE to_jsonb(r) END,
  'currentSourceHash',current_state->'source'->'sourceHash',
  'sourceCurrent',r.request_id IS NOT NULL AND r.source_hash=current_state->'source'->>'sourceHash');
END $$;
REVOKE ALL ON FUNCTION public.get_tournament_ranking_review_receipt_v1(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_ranking_review_receipt_v1(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.confirm_tournament_ranking_review_v1(p_tournament_id uuid,p_expected_source_hash text,
 p_ordered_entry_ids uuid[],p_request_id uuid,p_expected_actor_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;s jsonb;existing floor_private.tournament_ranking_reviews296%ROWTYPE;
 winner uuid;actual_ids uuid[];provided_ids uuid[];receipt jsonb;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'ranking_review_actor_or_request_required' USING ERRCODE='42501';END IF;
 SELECT club_id INTO club FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF club IS NULL OR NOT(public.is_club_cashier(actor,club) OR public.is_club_admin(actor,club)
  OR public.is_club_owner(actor,club) OR public.has_role(actor,'super_admin'::public.app_role))
 THEN RAISE EXCEPTION 'actor_not_allowed' USING ERRCODE='42501';END IF;
 SELECT * INTO existing FROM floor_private.tournament_ranking_reviews296 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF existing.tournament_id IS DISTINCT FROM p_tournament_id OR existing.source_hash IS DISTINCT FROM p_expected_source_hash
   OR existing.ordered_entry_ids IS DISTINCT FROM p_ordered_entry_ids THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('ok',true,'outcome','recorded','review',to_jsonb(existing));
 END IF;
 PERFORM 1 FROM public.tournament_entries WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 s:=floor_private.tournament_ranking_source296(p_tournament_id);
 IF s->>'sourceHash' IS DISTINCT FROM p_expected_source_hash THEN RAISE EXCEPTION 'ranking_review_source_changed'; END IF;
 IF (s->>'hasOfficial')::boolean OR EXISTS(SELECT 1 FROM public.tournament_close_report WHERE tournament_id=p_tournament_id)
  OR EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=p_tournament_id)
 THEN RAISE EXCEPTION 'ranking_review_results_immutable'; END IF;
 IF (s->>'survivors')::int<>1 OR (s->>'field')::int<2 OR (s->>'missingOrders')::int<>0
  OR (s->>'activeHand')::boolean OR (s->>'evidencePending')::boolean
  OR NOT (s->>'requiresReview')::boolean THEN RAISE EXCEPTION 'ranking_review_not_ready'; END IF;
 SELECT array_agg((x->>'entryId')::uuid ORDER BY (x->>'entryId')::uuid),
  (array_agg((x->>'entryId')::uuid) FILTER(WHERE coalesce(x->>'status','')<>'busted'))[1]
 INTO actual_ids,winner FROM jsonb_array_elements(s->'entries')x;
 SELECT array_agg(x ORDER BY x) INTO provided_ids FROM unnest(p_ordered_entry_ids)x;
 IF actual_ids IS DISTINCT FROM provided_ids OR p_ordered_entry_ids[1] IS DISTINCT FROM winner
  OR array_lower(p_ordered_entry_ids,1) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'ranking_review_invalid_order'; END IF;
 -- Only exchange places within one simultaneous group. Preserve every
 -- unrelated sequential elimination's existing rank slot and the winner.
 IF EXISTS(SELECT 1 FROM unnest(p_ordered_entry_ids) WITH ORDINALITY proposed(entry_id,place)
  WHERE proposed.entry_id::text IS DISTINCT FROM s->'entries'->(proposed.place::int-1)->>'entryId'
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'simultaneousGroups')g
    WHERE (g->'entryIds') ? proposed.entry_id::text
     AND (g->'entryIds') ? (s->'entries'->(proposed.place::int-1)->>'entryId')))
 THEN RAISE EXCEPTION 'ranking_review_unrelated_place_changed'; END IF;
 IF EXISTS(SELECT 1 FROM floor_private.tournament_ranking_reviews296 WHERE tournament_id=p_tournament_id AND source_hash=p_expected_source_hash)
 THEN RAISE EXCEPTION 'ranking_review_already_recorded'; END IF;
 INSERT INTO floor_private.tournament_ranking_reviews296(tournament_id,source_hash,ordered_entry_ids,actor_id,request_id)
 VALUES(p_tournament_id,p_expected_source_hash,p_ordered_entry_ids,actor,p_request_id) RETURNING to_jsonb(tournament_ranking_reviews296.*) INTO receipt;
 RETURN jsonb_build_object('ok',true,'outcome','recorded','review',receipt);
END $$;
REVOKE ALL ON FUNCTION public.confirm_tournament_ranking_review_v1(uuid,text,uuid[],uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_tournament_ranking_review_v1(uuid,text,uuid[],uuid,uuid) TO authenticated;

DO $patch$
DECLARE definition text;anchor text;replacement text;
BEGIN
 definition:=replace(pg_get_functiondef('public.finalize_tournament_results(uuid)'::regprocedure),chr(13),'');
 anchor:='  v_any_bust_order boolean;';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'ranking296_declaration_drift';END IF;
 definition:=replace(definition,anchor,anchor||E'\n  ranking_source jsonb; reviewed_order uuid[];');
 anchor:='  -- (a) Clear any finished_place on superseded bullets (a later bullet exists for the same player).';
 replacement:=$body$  ranking_source:=floor_private.tournament_ranking_source296(p_tournament_id);
  IF ranking_source->>'hasOfficial'='true' THEN
    IF floor_private.felt_official_results_close_status_v1(p_tournament_id)->>'status'='preserved' THEN
      RETURN jsonb_build_object('ok',true,'outcome','preserved','field',ranking_source->'field','survivors',1);
    END IF;
    RETURN jsonb_build_object('ok',false,'error','official_results_incomplete');
  END IF;
  IF ranking_source->>'activeHand'='true' OR ranking_source->>'evidencePending'='true' THEN
    RETURN jsonb_build_object('ok',false,'error','ranking_hand_evidence_pending');
  END IF;
  IF ranking_source->>'requiresReview'='true' THEN
    SELECT ordered_entry_ids INTO reviewed_order FROM floor_private.tournament_ranking_reviews296
      WHERE tournament_id=p_tournament_id AND source_hash=ranking_source->>'sourceHash';
    IF reviewed_order IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error','manual_ranking_review_required');
    END IF;
    UPDATE public.tournament_entries e SET finished_place=array_position(reviewed_order,e.id)
      WHERE e.tournament_id=p_tournament_id AND e.id=ANY(reviewed_order);
    GET DIAGNOSTICS v_set=ROW_COUNT;
    RETURN jsonb_build_object('ok',true,'field',ranking_source->'field','places_set',v_set,'survivors',1,'ranking_review',true);
  END IF;
$body$||anchor;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'ranking296_finalizer_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,replacement);
 definition:=replace(pg_get_functiondef('floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure),chr(13),'');
 anchor:='ELSE ''ready_to_finalize'' END';
 replacement:=$body$ELSE CASE WHEN (floor_private.tournament_ranking_source296(p_tournament_id)->>'requiresReview')::boolean
   AND NOT EXISTS(SELECT 1 FROM floor_private.tournament_ranking_reviews296 r WHERE r.tournament_id=p_tournament_id
    AND r.source_hash=floor_private.tournament_ranking_source296(p_tournament_id)->>'sourceHash')
   THEN 'manual_ranking_review_required' ELSE 'ready_to_finalize' END END$body$;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'ranking296_readiness_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,replacement);
END $patch$;
COMMIT;
