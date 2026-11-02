-- Caller owns transaction. Exact inverse definitions only; never restore data.
DO $$
DECLARE target regprocedure:='public.get_tournament_participation_counts_v1(uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 addition text:=E'\n   ''prize_pool'',floor_private.tournament_tv_pool_v1(p_tournament_id),';
BEGIN
 IF length(definition)-length(replace(definition,addition,''))<>length(addition) THEN RAISE EXCEPTION 'tv220_summary_recovery_drift';END IF;
 EXECUTE replace(definition,addition,'');
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)='2075e3e28f93fdb7c4396d38264aecc4';
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
 IF length(definition)-length(replace(definition,new_block,''))<>length(new_block) THEN RAISE EXCEPTION 'tv220_display_recovery_drift';END IF;
 EXECUTE replace(definition,new_block,old_block);
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)='94286ab165968ecc7dbab891b47a3cc7';
END $$;
DROP FUNCTION floor_private.tournament_tv_pool_v1(uuid);
