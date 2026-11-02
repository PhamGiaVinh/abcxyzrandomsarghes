-- Exact code-only down. No confirmed individual history may be detached from its finalizer.
-- Run BEFORE the individual-rank1162 down, in one explicit guarded transaction.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM private.multi_day_individual_results_v1) OR EXISTS(SELECT 1 FROM private.multi_day_individual_rank_requests_v1) THEN RAISE EXCEPTION 'individual_finalizer_history_retained_use_forward_repair';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='finalize_tournament_results(uuid)'::regprocedure) IS DISTINCT FROM '23d137a3ade2c3e6878a457fcc44d95f' THEN RAISE EXCEPTION 'individual_finalizer_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_individual_close_state_v1(uuid)'::regprocedure) IS DISTINCT FROM 'f070fa5848efefde0af7ef172782e95f' THEN RAISE EXCEPTION 'individual_finalizer_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.finalize_multi_day_individual_results_v1(uuid)'::regprocedure) IS DISTINCT FROM 'ab260ef7a0b19250b1c9d11290633656' THEN RAISE EXCEPTION 'individual_finalizer_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure) IS DISTINCT FROM 'd758a0ce2af57acac03177735cd761c5' THEN RAISE EXCEPTION 'individual_finalizer_down_body_drift';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.finalize_tournament_results(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller         uuid := auth.uid();
  v_club           uuid;
  v_field          integer;
  v_survivors      integer;
  v_set            integer := 0;
  v_any_bust_order boolean;
  ranking_source jsonb; reviewed_order uuid[];
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  SELECT club_id INTO v_club FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_club IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  IF NOT (public.is_club_cashier(v_caller, v_club) OR public.is_club_admin(v_caller, v_club)
       OR public.is_club_owner(v_caller, v_club) OR public.has_role(v_caller, 'super_admin'::app_role)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Guard (post-audit P1): only rank once the field is truly down to a winner. Calling this earlier —
  -- or again later after late-registration/further busts changed the distinct-player count — would
  -- silently SHIFT already-assigned places for earlier-out players (field size moves, dense_rank doesn't).
  -- Refuse instead of doing a partial/shifting pass; the caller retries once the tournament is closed.
  SELECT count(*) INTO v_survivors FROM public.tournament_entries
    WHERE tournament_id = p_tournament_id AND COALESCE(status, '') <> 'busted';
  IF v_survivors <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_finished', 'survivors', v_survivors);
  END IF;

  -- Guard (post-audit P2): finished_place is only meaningful if bust_order was actually captured during
  -- play (club_settings.player_history_enabled was on). Otherwise only the winner could ever be ranked —
  -- a silent, misleading partial result. Refuse explicitly rather than writing a 1-place-only outcome.
  SELECT EXISTS (
    SELECT 1 FROM public.tournament_entries WHERE tournament_id = p_tournament_id AND bust_order IS NOT NULL
  ) INTO v_any_bust_order;
  IF NOT v_any_bust_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_bust_order_captured');
  END IF;

  ranking_source:=floor_private.tournament_ranking_source296(p_tournament_id);
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
  -- (a) Clear any finished_place on superseded bullets (a later bullet exists for the same player).
  UPDATE public.tournament_entries te SET finished_place = NULL
  WHERE te.tournament_id = p_tournament_id
    AND te.finished_place IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tournament_entries e2
      WHERE e2.tournament_id = te.tournament_id
        AND COALESCE(e2.member_id::text, e2.player_id::text) = COALESCE(te.member_id::text, te.player_id::text)
        AND e2.entry_no > te.entry_no
    );

  -- (b) Official place for each player's LAST (non-superseded) BUSTED bullet.
  WITH last_bullets AS (
    SELECT e.id, e.bust_order,
      row_number() OVER (
        PARTITION BY COALESCE(e.member_id::text, e.player_id::text)
        ORDER BY e.entry_no DESC NULLS LAST, e.created_at DESC
      ) AS rn
    FROM public.tournament_entries e
    WHERE e.tournament_id = p_tournament_id
  ),
  finals AS (SELECT id, bust_order FROM last_bullets WHERE rn = 1),
  fld    AS (SELECT count(*) AS field FROM finals),
  elim   AS (SELECT id, dense_rank() OVER (ORDER BY bust_order ASC) AS er
             FROM finals WHERE bust_order IS NOT NULL)
  UPDATE public.tournament_entries te
    SET finished_place = (SELECT field FROM fld) - el.er + 1
  FROM finals f JOIN elim el ON el.id = f.id
  WHERE te.id = f.id
    AND te.finished_place IS DISTINCT FROM ((SELECT field FROM fld) - el.er + 1);
  GET DIAGNOSTICS v_set = ROW_COUNT;

  SELECT count(*) INTO v_field FROM (
    SELECT DISTINCT COALESCE(member_id::text, player_id::text)
    FROM public.tournament_entries WHERE tournament_id = p_tournament_id
  ) x;

  -- (c) Winner = the single survivor's last bullet -> place 1. v_survivors already checked <= 1 above.
  IF v_survivors <= 1 THEN
    WITH last_bullets AS (
      SELECT e.id, e.bust_order,
        row_number() OVER (
          PARTITION BY COALESCE(e.member_id::text, e.player_id::text)
          ORDER BY e.entry_no DESC NULLS LAST, e.created_at DESC
        ) AS rn
      FROM public.tournament_entries e
      WHERE e.tournament_id = p_tournament_id
    )
    UPDATE public.tournament_entries te SET finished_place = 1
    FROM last_bullets lb
    WHERE te.id = lb.id AND lb.rn = 1 AND lb.bust_order IS NULL
      AND te.finished_place IS DISTINCT FROM 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'field', v_field, 'places_set', v_set, 'survivors', v_survivors);
END;
$function$
;
CREATE OR REPLACE FUNCTION floor_private.felt_official_results_close_status_v1(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  ELSE CASE WHEN (floor_private.tournament_ranking_source296(p_tournament_id)->>'requiresReview')::boolean
   AND NOT EXISTS(SELECT 1 FROM floor_private.tournament_ranking_reviews296 r WHERE r.tournament_id=p_tournament_id
    AND r.source_hash=floor_private.tournament_ranking_source296(p_tournament_id)->>'sourceHash')
   THEN 'manual_ranking_review_required' ELSE 'ready_to_finalize' END END) FROM facts;
$function$
;
DROP FUNCTION private.finalize_multi_day_individual_results_v1(uuid);
DROP FUNCTION private.multi_day_individual_close_state_v1(uuid);
