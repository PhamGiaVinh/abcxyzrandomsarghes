-- LOCAL/SOURCE ONLY. CLI candidate20261016222631, reserved forward slot127.
-- Preserve qualified bag stacks and all immutable write intents. No legacy-ID
-- backfill, second buy-in, denomination issuance, or payout policy change.
-- Recovery: suspend final seating and restore pinned reviewed body via a new
-- migration; retain entries, receipts and audits already committed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 target regprocedure:='public.multi_day_seat_final_v1(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 needle text:=$old$ SELECT * INTO v_table FROM public.tournament_tables WHERE id=p_tournament_table_id
   AND tournament_id=v_final.id FOR UPDATE;
 IF NOT FOUND OR v_table.status<>'active' OR v_table.table_id IS NULL OR
    v_table.table_session_id IS NULL OR p_seat_number>v_table.max_seats THEN
   RAISE EXCEPTION 'multi_day_final_table_unavailable' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_session FROM public.table_sessions WHERE id=v_table.table_session_id;
 IF NOT FOUND OR v_session.tournament_id IS DISTINCT FROM v_final.id OR
    v_session.game_table_id IS DISTINCT FROM v_table.table_id THEN
   RAISE EXCEPTION 'multi_day_final_session_mismatch' USING ERRCODE='23514';
 END IF;$old$;
 replacement text:=$new$ -- Same lock order as Floor: tournament (already held), physical,
 -- exact session, tournament table. The first lookup is not authoritative.
 SELECT game_table_id,table_session_id INTO v_physical,v_expected_session
 FROM public.tournament_tables WHERE id=p_tournament_table_id AND tournament_id=v_final.id;
 IF NOT FOUND OR v_physical IS NULL OR v_expected_session IS NULL THEN
   RAISE EXCEPTION 'multi_day_final_table_unavailable' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public.game_tables WHERE id=v_physical AND club_id=v_final.club_id FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'multi_day_final_table_scope_mismatch' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_session FROM public.table_sessions WHERE id=v_expected_session FOR UPDATE;
 IF NOT FOUND OR v_session.closed_at IS NOT NULL OR
    v_session.session_type IS DISTINCT FROM 'tournament' OR
    v_session.club_id IS DISTINCT FROM v_final.club_id OR
    v_session.tournament_id IS DISTINCT FROM v_final.id OR
    v_session.game_table_id IS DISTINCT FROM v_physical THEN
   RAISE EXCEPTION 'multi_day_final_session_mismatch' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_table FROM public.tournament_tables WHERE id=p_tournament_table_id
   AND tournament_id=v_final.id AND game_table_id=v_physical
   AND table_session_id=v_expected_session FOR UPDATE;
 IF NOT FOUND OR v_table.status IS DISTINCT FROM 'active' OR
    v_table.max_seats IS NULL OR v_table.max_seats NOT IN(8,9) OR
    p_seat_number>v_table.max_seats OR
    (v_table.table_id IS NOT NULL AND v_table.table_id IS DISTINCT FROM v_physical) THEN
   RAISE EXCEPTION 'multi_day_final_table_unavailable' USING ERRCODE='23514';
 END IF;
 IF v_session.redraw_hold_batch_id IS NOT NULL OR
    floor_private.floor_table_v3_has_active_hand(v_final.id,v_table.id,v_session.id) OR
    EXISTS(SELECT 1 FROM public.table_session_seat_locks l
      WHERE l.table_session_id=v_session.id AND l.seat_number=p_seat_number AND l.unlocked_at IS NULL) OR
    EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves m
      WHERE m.status='pending' AND (m.source_table_session_id=v_session.id OR m.destination_table_session_id=v_session.id)) THEN
   RAISE EXCEPTION 'multi_day_final_destination_blocked' USING ERRCODE='23514';
 END IF;$new$;
BEGIN
 IF current_user<>'postgres' OR md5(definition)<>'d28ff6121b7f5136a361c2ee7cb85645' THEN
   RAISE EXCEPTION 'multiday127_catalog_drift'; END IF;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) OR
    (length(definition)-length(replace(definition,'v_table.table_id','')))/length('v_table.table_id')<>6 THEN
   RAISE EXCEPTION 'multiday127_anchor_drift'; END IF;
 -- Replace downstream hash, entry, receipt and audit physical IDs as well as
 -- guards, but keep the explicit dual-ID conflict guard in replacement above.
 definition:=replace(definition,needle,'__CANONICAL_DESTINATION_127__');
 definition:=replace(definition,'v_table.table_id','v_table.game_table_id');
 definition:=replace(definition,'__CANONICAL_DESTINATION_127__',replacement);
 definition:=replace(definition,' v_prior public.multi_day_final_requests_v1%ROWTYPE;',
   ' v_prior public.multi_day_final_requests_v1%ROWTYPE; v_physical uuid; v_expected_session uuid;');
 EXECUTE definition;
END $patch$;
COMMIT;
