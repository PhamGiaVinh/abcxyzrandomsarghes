-- LOCAL/SOURCE ONLY. CLI candidate20261016223113, forward catalog130.
-- Read locked qualification, never legacy qualifier/current-player identity.
-- Recovery: revoke this read RPC in a forward migration. No business writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_user<>'postgres' OR to_regprocedure('public.multi_day_final_roster_v1(uuid)') IS NOT NULL OR
    to_regprocedure('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)') IS NULL THEN
   RAISE EXCEPTION 'multiday130_catalog_drift'; END IF;
END $$;
CREATE FUNCTION public.multi_day_final_roster_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid:=auth.uid(); rules public.multi_day_qualification_rules_v1;
 final public.tournaments; qualification public.multi_day_qualification_locks_v1;
 players jsonb; tables jsonb; enabled boolean;
BEGIN
 SELECT * INTO rules FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 IF actor IS NULL OR NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clubs c
   WHERE c.id=rules.club_id AND (c.owner_id=actor OR public.is_club_floor(actor,c.id))) THEN
   RAISE EXCEPTION 'multi_day_final_roster_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO final FROM public.tournaments WHERE id=rules.final_tournament_id;
 IF NOT FOUND OR final.event_id IS DISTINCT FROM p_event_id OR final.club_id IS DISTINCT FROM rules.club_id OR final.phase<>'final' THEN
   RAISE EXCEPTION 'multi_day_final_tournament_mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO qualification FROM public.multi_day_qualification_locks_v1 WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_final_not_qualified' USING ERRCODE='23514'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
   WHERE g.id AND g.enabled AND rules.club_id=ANY(g.allowed_club_ids)) INTO enabled;

 SELECT coalesce(jsonb_agg(row.data ORDER BY row.participation_id),'[]'::jsonb) INTO players
 FROM (
  SELECT p.id participation_id,jsonb_build_object(
   'participationId',p.id,'playerId',p.player_id,'policy',p.policy,
   'name',display.name,'stack',coalesce(revision.revised_stack,p.carried_stack),
   'seedRevision',coalesce(revision.revision,0),'sourceBags',p.source_bags,
   'entryId',seated.entry_id,'seatId',seated.seat_id,
   'state',CASE WHEN seated.participation_id IS NOT NULL THEN 'SEATED'
     WHEN display.name IS NULL OR EXISTS(SELECT 1 FROM public.tournament_entries e
       WHERE e.tournament_id=final.id AND e.player_id=p.player_id) THEN 'BLOCKED'
     ELSE 'UNSEATED' END,
   'blocker',CASE WHEN seated.participation_id IS NOT NULL THEN NULL
     WHEN display.name IS NULL THEN 'display_evidence_missing'
     WHEN EXISTS(SELECT 1 FROM public.tournament_entries e
       WHERE e.tournament_id=final.id AND e.player_id=p.player_id) THEN 'existing_entry_requires_review'
     ELSE NULL END) data
  FROM public.multi_day_final_participations_v1 p
  LEFT JOIN public.multi_day_final_seatings_v1 seated ON seated.participation_id=p.id
  LEFT JOIN LATERAL(SELECT r.revision,r.revised_stack FROM public.multi_day_final_stack_revisions_v1 r
    WHERE r.participation_id=p.id ORDER BY r.revision DESC LIMIT 1) revision ON true
  LEFT JOIN LATERAL(
    SELECT coalesce(nullif(btrim(b.player_name),''),nullif(btrim(
      floor_private.tournament_entry_display_v1(e.id,e.player_id,e.tournament_id,e.entry_no)->>'player_name'),'')) name
    FROM jsonb_array_elements(p.source_bags) x
    JOIN public.chip_bag b ON b.id=(x->>'bagId')::uuid
    JOIN public.tournament_entries e ON e.id=(x->>'sourceEntryId')::uuid
      AND e.player_id=p.player_id AND e.tournament_id=(x->>'flightId')::uuid
    ORDER BY (x->>'stack')::bigint DESC,b.id LIMIT 1
  ) display ON true
  WHERE p.event_id=p_event_id AND p.final_tournament_id=final.id
 ) row;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'tournamentTableId',tt.id,'physicalTableId',tt.game_table_id,'tableSessionId',s.id,
   'tableNumber',gt.table_number,'capacity',tt.max_seats,
   'revision',s.revision,'epoch',s.control_epoch,
   'occupiedSeats',(SELECT coalesce(jsonb_agg(q.seat_number ORDER BY q.seat_number),'[]'::jsonb)
     FROM public.tournament_seats q WHERE q.tournament_table_id=tt.id AND q.is_active),
   'lockedSeats',(SELECT coalesce(jsonb_agg(l.seat_number ORDER BY l.seat_number),'[]'::jsonb)
     FROM public.table_session_seat_locks l WHERE l.table_session_id=s.id AND l.unlocked_at IS NULL),
   'blocker',CASE
    WHEN tt.status IS DISTINCT FROM 'active' OR gt.id IS NULL OR gt.club_id IS DISTINCT FROM rules.club_id OR
      (tt.table_id IS NOT NULL AND tt.table_id IS DISTINCT FROM tt.game_table_id) OR
      tt.max_seats IS NULL OR tt.max_seats NOT IN(8,9) THEN 'table_requires_review'
    WHEN s.id IS NULL OR s.closed_at IS NOT NULL OR s.club_id IS DISTINCT FROM rules.club_id OR
      s.game_table_id IS DISTINCT FROM tt.game_table_id OR s.tournament_id IS DISTINCT FROM final.id OR
      s.session_type IS DISTINCT FROM 'tournament' THEN 'session_requires_review'
    WHEN s.redraw_hold_batch_id IS NOT NULL THEN 'redraw_hold'
    WHEN floor_private.floor_table_v3_has_active_hand(final.id,tt.id,s.id) THEN 'active_hand'
    WHEN EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves m WHERE m.status='pending'
      AND (m.source_table_session_id=s.id OR m.destination_table_session_id=s.id)) THEN 'pending_move'
    ELSE NULL END) ORDER BY gt.table_number,tt.id),'[]'::jsonb) INTO tables
 FROM public.tournament_tables tt LEFT JOIN public.game_tables gt ON gt.id=tt.game_table_id
 LEFT JOIN public.table_sessions s ON s.id=tt.table_session_id WHERE tt.tournament_id=final.id;
 RETURN jsonb_build_object('eventId',p_event_id,'finalTournamentId',final.id,
   'qualificationHash',qualification.source_hash,'releaseEnabled',enabled,
   'sourceHash',md5(jsonb_build_object('qualification',qualification.source_hash,'players',players)::text),
   'players',players,'tables',tables);
END $$;
ALTER FUNCTION public.multi_day_final_roster_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.multi_day_final_roster_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_final_roster_v1(uuid) TO authenticated;
COMMIT;
