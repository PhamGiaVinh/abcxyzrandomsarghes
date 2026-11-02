-- CLI generated20261020194651; reserved local220. Requires reviewed219 getter.
-- Reuse the existing authorized summary; no new browser endpoint/private grants.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_user<>'postgres'
  OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_tournament_participation_counts_v1(uuid)'::regprocedure)<>'2075e3e28f93fdb7c4396d38264aecc4'
  OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_tv_display_state_v4(text,boolean)'::regprocedure)<>'94286ab165968ecc7dbab891b47a3cc7'
  OR to_regprocedure('floor_private.tournament_tv_pool_v1(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'tv220_shared_pool_precondition_drift';END IF;
END $$;
CREATE FUNCTION floor_private.tournament_tv_pool_v1(p_tournament_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN f.event_id IS NOT NULL THEN f.direct_pool_vnd+f.recorded_overlay_vnd ELSE t.prize_pool END
 FROM public.tournaments t
 LEFT JOIN public.tournament_events e ON e.id=t.event_id AND e.club_id=t.club_id
 LEFT JOIN public.multi_day_payout_finalizations_v1 f ON f.final_tournament_id=t.id AND f.event_id=e.id AND f.club_id=t.club_id
 WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION floor_private.tournament_tv_pool_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE target regprocedure:='public.get_tournament_participation_counts_v1(uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 anchor text:=$a$ RETURN jsonb_build_object('tournament_id',p_tournament_id,'counts',counts,$a$;
BEGIN
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'tv220_summary_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,anchor||E'\n   ''prize_pool'',floor_private.tournament_tv_pool_v1(p_tournament_id),');
END $$;
DO $$
DECLARE target regprocedure:='public.get_tv_display_state_v4(text,boolean)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 old_block text:=$old$
 -- TV219: the carry-entry Final has no new buy-ins. Only its exact immutable
 -- finalization supplies its event pool; never copy this amount into a flight.
 payload:=jsonb_set(payload,'{tournament}',payload->'tournament'||COALESCE((
  SELECT jsonb_build_object('prize_pool',f.direct_pool_vnd+f.recorded_overlay_vnd)
  FROM public.multi_day_payout_finalizations_v1 f
  JOIN public.tournaments t ON t.id=f.final_tournament_id AND t.event_id=f.event_id AND t.club_id=f.club_id
  JOIN public.tournament_events e ON e.id=f.event_id AND e.club_id=f.club_id
  WHERE f.final_tournament_id=d.assigned_tournament_id AND f.club_id=d.club_id
    AND t.deleted_at IS NULL),'{}'::jsonb),true);
$old$;
 new_block text:=$new$
 -- TV220: same scoped funding calculation as the authorized UUID summary.
 payload:=jsonb_set(payload,'{tournament}',payload->'tournament'||jsonb_build_object(
  'prize_pool',floor_private.tournament_tv_pool_v1(d.assigned_tournament_id)),true);
$new$;
BEGIN
 IF length(definition)-length(replace(definition,old_block,''))<>length(old_block) THEN RAISE EXCEPTION 'tv220_display_anchor_drift';END IF;
 EXECUTE replace(definition,old_block,new_block);
END $$;
COMMIT;
