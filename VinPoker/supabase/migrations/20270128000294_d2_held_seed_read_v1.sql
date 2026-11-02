-- Additive private operational projection only. No seed/chip/receipt writes.
-- Recovery: restore exact predecessor function definition/ACL from release backup.
BEGIN;
DO $migration$
DECLARE target regprocedure:='public.multi_day_final_roster_v1(uuid)'::regprocedure;
 body text;prior_acl aclitem[];prior_owner oid;prior_config text[];
 anchor text:=$anchor$'initialDraws',(SELECT$anchor$;
 addition text:=$addition$'heldSeedAdjustments',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'requestId',a.request_id,'participationId',p.id,'playerId',p.player_id,
    'entryId',s.entry_id,'seatId',s.seat_id,
    'priorSeedStack',a.prior_seed_stack,'proposedSeedStack',a.proposed_seed_stack,
    'deltaChips',a.delta_chips,'seedRevision',a.seed_revision,
    'status',a.status,'liveStackChanged',false,'createdAt',a.created_at)
    ORDER BY a.created_at,a.request_id),'[]'::jsonb)
   FROM public.multi_day_final_adjustments_v1 a
   JOIN public.multi_day_final_participations_v1 p ON p.id=a.participation_id
   JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=a.seating_participation_id
     AND s.participation_id=p.id AND s.player_id=p.player_id AND s.final_tournament_id=final.id
   WHERE p.event_id=p_event_id AND p.final_tournament_id=final.id
     AND a.status='OWNER_APPROVED_HELD'),
   'initialDraws',(SELECT$addition$;
BEGIN
 body:=pg_get_functiondef(target);
 IF md5(body)<>'2bee10bb56c171fd7cd031c42d47c7ac'
    OR length(body)-length(replace(body,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'd2_held_seed_read_predecessor_changed';
 END IF;
 IF has_function_privilege('anon',target,'EXECUTE') THEN
  RAISE EXCEPTION 'd2_held_seed_read_public_authority_unexpected';
 END IF;
 SELECT proacl,proowner,proconfig INTO STRICT prior_acl,prior_owner,prior_config FROM pg_proc WHERE oid=target;
 EXECUTE replace(body,anchor,addition);
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND prosecdef
    AND proacl IS NOT DISTINCT FROM prior_acl AND proowner=prior_owner
    AND proconfig IS NOT DISTINCT FROM prior_config) THEN
  RAISE EXCEPTION 'd2_held_seed_read_metadata_changed';
 END IF;
END $migration$;
COMMIT;
