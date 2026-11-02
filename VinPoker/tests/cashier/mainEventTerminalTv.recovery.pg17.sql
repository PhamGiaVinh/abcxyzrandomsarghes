-- Caller transaction owns COMMIT/ROLLBACK. Restore only the reviewed getter;
-- never restore data or financial ledgers. Refuse extra/unreviewed changes.
DO $$
DECLARE target regprocedure:='public.get_tv_display_state_v4(text,boolean)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
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
 IF current_user<>'postgres' OR length(definition)-length(replace(definition,addition,''))<>length(addition)
 THEN RAISE EXCEPTION 'tv219_recovery_definition_drift';END IF;
 definition:=replace(definition,addition,'');
 EXECUTE definition;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'97476219ce3d2e09e8900c61842099a2'
 THEN RAISE EXCEPTION 'tv219_recovery_inverse_mismatch';END IF;
END $$;
