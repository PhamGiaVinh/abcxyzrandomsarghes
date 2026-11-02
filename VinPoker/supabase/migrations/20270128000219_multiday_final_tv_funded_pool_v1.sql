-- CLI generated20261020193700; reserved local forward219 after catalog check.
-- Display-only: finalized Final Day reads the frozen funded pool (not GTD,
-- not rank awards alone, not fees). Flights and pre-finalization stay unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE target regprocedure:='public.get_tv_display_state_v4(text,boolean)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 anchor text:=$anchor$ RETURN payload||jsonb_build_object('re_entries',counts->'re_entries','participation_counts',counts);$anchor$;
 addition text:=$new$
 -- TV219: the carry-entry Final has no new buy-ins. Only its exact immutable
 -- finalization supplies its event pool; never copy this amount into a flight.
 payload:=jsonb_set(payload,'{tournament}',payload->'tournament'||COALESCE((
  SELECT jsonb_build_object('prize_pool',f.direct_pool_vnd+f.recorded_overlay_vnd)
  FROM public.multi_day_payout_finalizations_v1 f
  JOIN public.tournaments t ON t.id=f.final_tournament_id AND t.event_id=f.event_id AND t.club_id=f.club_id
  JOIN public.tournament_events e ON e.id=f.event_id AND e.club_id=f.club_id
  WHERE f.final_tournament_id=d.assigned_tournament_id AND f.club_id=d.club_id
    AND t.deleted_at IS NULL),'{}'::jsonb),true);
$new$;
BEGIN
 IF current_user<>'postgres' OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)
   <>'97476219ce3d2e09e8900c61842099a2'
  OR to_regclass('public.multi_day_payout_finalizations_v1') IS NULL
  OR length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 THEN RAISE EXCEPTION 'tv219_final_funding_precondition_drift';END IF;
 EXECUTE replace(definition,anchor,addition||anchor);
END $$;
-- CREATE OR REPLACE preserves existing grants. No new public endpoint or data
-- access; all token/revocation/exact-club checks run before this projection.
COMMIT;
