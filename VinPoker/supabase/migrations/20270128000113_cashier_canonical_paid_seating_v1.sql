-- CLI candidate20261016091622; local catalog113, NOT RELEASED.
-- Preserve paid pricing/confirmation/entry/receipt core; replace its legacy
-- table selection with exact, locked canonical session allocation.
-- Recovery is reviewed forward restoration with seating disabled; never delete
-- paid registrations, entries, tickets, money ledger or historical sessions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_get_functiondef(
  'public.confirm_registration_and_assign_seat(uuid,uuid,text)'::regprocedure),chr(13),''))<>'05ed7956ea38e7cbeebb4928a6a90922'
 OR to_regprocedure('floor_private.pick_cashier_canonical_seat_v1(uuid,text)') IS NOT NULL
 OR to_regprocedure('floor_private.floor_table_v3_has_active_hand(uuid,uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'paid_seating113_dependency_or_catalog_drift'; END IF;
END $$;

CREATE FUNCTION floor_private.pick_cashier_canonical_seat_v1(p_tournament_id uuid,p_draw_mode text)
RETURNS TABLE(logical_id uuid,physical_id uuid,session_id uuid,number integer,capacity integer,seat integer,epoch bigint)
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE candidate record; tour public.tournaments%ROWTYPE;
 tt public.tournament_tables%ROWTYPE; sess public.table_sessions%ROWTYPE; free_seat integer;
BEGIN
 -- Parent already holds its registration and tournament locks. Match Floor's
 -- remaining order: physical -> exact session -> logical table. NOWAIT prevents
 -- a legacy competing lock order from turning this allocation into a deadlock.
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF tour.id IS NULL OR tour.deleted_at IS NOT NULL OR tour.status IN ('completed','cancelled') THEN RETURN;END IF;
 FOR candidate IN
  SELECT t.id logical_id,coalesce(t.game_table_id,t.table_id) physical_id,t.table_session_id session_id,
   t.table_number,counted.active_count
  FROM public.tournament_tables t
  CROSS JOIN LATERAL(SELECT count(*) active_count FROM public.tournament_seats s
   WHERE s.is_active AND s.tournament_id=t.tournament_id AND
    (s.tournament_table_id=t.id OR s.table_id=t.id OR s.table_session_id=t.table_session_id)) counted
  WHERE t.tournament_id=tour.id AND t.status='active' AND t.table_session_id IS NOT NULL
   AND coalesce(t.game_table_id,t.table_id) IS NOT NULL
   AND (t.game_table_id IS NULL OR t.table_id IS NULL OR t.game_table_id=t.table_id)
   AND t.max_seats IN (8,9) AND counted.active_count<t.max_seats
  ORDER BY CASE WHEN p_draw_mode='fill_lowest_table' THEN t.table_number END ASC NULLS LAST,
   counted.active_count,random()
 LOOP
  BEGIN
   PERFORM 1 FROM public.game_tables g WHERE g.id=candidate.physical_id AND g.club_id=tour.club_id FOR UPDATE NOWAIT;
   IF NOT FOUND THEN CONTINUE;END IF;
   SELECT * INTO sess FROM public.table_sessions s WHERE s.id=candidate.session_id
    AND s.game_table_id=candidate.physical_id AND s.club_id=tour.club_id AND s.tournament_id=tour.id
    AND s.session_type='tournament' AND s.closed_at IS NULL FOR UPDATE NOWAIT;
   IF NOT FOUND THEN CONTINUE;END IF;
   IF (SELECT count(*) FROM public.table_sessions s WHERE s.game_table_id=candidate.physical_id AND s.closed_at IS NULL)<>1 THEN CONTINUE;END IF;
   SELECT * INTO tt FROM public.tournament_tables t WHERE t.id=candidate.logical_id AND t.tournament_id=tour.id
    AND t.status='active' AND t.table_session_id=sess.id AND coalesce(t.game_table_id,t.table_id)=candidate.physical_id
    AND (t.game_table_id IS NULL OR t.table_id IS NULL OR t.game_table_id=t.table_id) FOR UPDATE NOWAIT;
   IF NOT FOUND OR tt.max_seats NOT IN (8,9) THEN CONTINUE;END IF;
   IF floor_private.floor_table_v3_has_active_hand(tour.id,tt.id,sess.id) THEN CONTINUE;END IF;
   IF EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves q WHERE q.status='pending'
    AND q.source_table_session_id=sess.id) THEN CONTINUE;END IF;
   IF EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 r WHERE r.table_session_id=sess.id AND r.status='pending') THEN CONTINUE;END IF;
   IF EXISTS(SELECT 1 FROM public.tracker_voice_configs c WHERE c.tournament_table_id=tt.id
    AND (c.table_session_id=sess.id OR c.table_session_id IS NULL) AND c.correction_state='correction_pending') THEN CONTINUE;END IF;
   SELECT n INTO free_seat FROM generate_series(1,tt.max_seats) n
   WHERE NOT EXISTS(SELECT 1 FROM public.tournament_seats s WHERE s.is_active AND s.tournament_id=tour.id
     AND (s.tournament_table_id=tt.id OR s.table_id=tt.id OR s.table_session_id=sess.id) AND s.seat_number=n)
    AND NOT EXISTS(SELECT 1 FROM public.table_session_seat_locks l WHERE l.table_session_id=sess.id AND l.seat_number=n AND l.unlocked_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves q WHERE q.status='pending'
     AND q.destination_table_session_id=sess.id AND q.destination_seat_number=n)
   ORDER BY random() LIMIT 1;
   IF free_seat IS NULL THEN CONTINUE;END IF;
   RETURN QUERY SELECT tt.id,candidate.physical_id,sess.id,tt.table_number::integer,tt.max_seats::integer,free_seat,sess.control_epoch::bigint;
   RETURN;
  EXCEPTION WHEN lock_not_available THEN CONTINUE;
  END;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION floor_private.pick_cashier_canonical_seat_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE target regprocedure:='public.confirm_registration_and_assign_seat(uuid,uuid,text)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 start_at integer; end_at integer; needle text; replacement text;
BEGIN
 needle:=E'  v_attempt        INTEGER := 0;\nBEGIN';
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'paid113_declare_anchor_drift';END IF;
 definition:=replace(definition,needle,E'  v_attempt        INTEGER := 0;\n  v_canonical_seat RECORD;\nBEGIN');
 start_at:=strpos(definition,'  -- 9. Pick a table with free capacity, then a random free seat.');
 end_at:=strpos(definition,'  -- 11. Create the entry (seated).');
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'paid113_allocator_anchor_drift';END IF;
 replacement:=$new$  IF v_starting_stack<=0 THEN RETURN jsonb_build_object('ok',false,'error','starting_stack_missing');END IF;
  IF v_tour.club_id IS DISTINCT FROM v_reg.club_id THEN RETURN jsonb_build_object('ok',false,'error','registration_club_mismatch');END IF;
  SELECT * INTO v_canonical_seat FROM floor_private.pick_cashier_canonical_seat_v1(v_reg.tournament_id,p_draw_mode);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','no_table_available');END IF;
  IF public.is_club_cashier(p_actor_user_id,v_tour.club_id) IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
  v_table_tour_id:=v_canonical_seat.logical_id;v_table_game_id:=v_canonical_seat.physical_id;
  v_table_number:=v_canonical_seat.number;v_max_seats:=v_canonical_seat.capacity;v_seat_number:=v_canonical_seat.seat;

$new$;
 definition:=substr(definition,1,start_at-1)||replacement||substr(definition,end_at);
 needle:=$old$    tournament_id, player_id, entry_number, table_id, seat_number,
    chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at$old$;
 replacement:=$new$    tournament_id, player_id, entry_number, table_id, seat_number,
    chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at, tournament_table_id, table_session_id$new$;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'paid113_seat_columns_anchor_drift';END IF;
 definition:=replace(definition,needle,replacement);
 needle:=$old$v_starting_stack, true, v_display_name, v_entry_id, 'active', p_actor_user_id, now()$old$;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'paid113_seat_values_anchor_drift';END IF;
 definition:=replace(definition,needle,needle||', v_table_tour_id, v_canonical_seat.session_id');
 needle:=$old$jsonb_build_object('draw_mode', p_draw_mode, 'registration_id', p_registration_id)$old$;
 replacement:=$new$jsonb_build_object('draw_mode',p_draw_mode,'registration_id',p_registration_id,
      'to_tournament_table_id',v_table_tour_id,'destination_session_id',v_canonical_seat.session_id,
      'receipt_code',v_receipt_code,'chip_count_at_move',v_starting_stack)$new$;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'paid113_audit_anchor_drift';END IF;
 definition:=replace(definition,needle,replacement);
 needle:='  -- 17. Result.';
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'paid113_revision_anchor_drift';END IF;
 definition:=replace(definition,needle,E'  UPDATE public.table_sessions SET revision=revision+1 WHERE id=v_canonical_seat.session_id;\n\n'||needle);
 EXECUTE definition;
END;
$patch$;
COMMIT;
