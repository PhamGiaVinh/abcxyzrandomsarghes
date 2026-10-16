-- CLI candidate20261016092637, catalog114; LOCAL ONLY, not released.
-- Preserve re-entry identity/pricing/chip projection. Replace only legacy
-- allocation and add canonical session/ticket-proof/revision fences.
-- Recovery: reviewed forward restoration with re-entry seating disabled;
-- never delete/rewrite entries, payment ledger, tickets or history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_get_functiondef(
  'public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure),chr(13),''))<>'520a828b16302ef18eb59ca6c7b7dc79'
 OR to_regprocedure('floor_private.pick_cashier_canonical_seat_v1(uuid,text)') IS NULL
 OR md5(replace(pg_get_functiondef('floor_private.pick_cashier_canonical_seat_v1(uuid,text)'::regprocedure),chr(13),''))<>'770a70ad4ae2226a2fdc82adf1e1f9ae'
 OR md5(replace(pg_get_functiondef('public.confirm_reentry_and_assign_seat(uuid,uuid,text)'::regprocedure),chr(13),''))<>'2f722587a1cf8ab76622a5319c8c4638'
 THEN RAISE EXCEPTION 'reentry114_dependency_or_catalog_drift';END IF;
END $$;
DO $patch$
DECLARE target regprocedure:='public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 needle text; replacement text; start_at integer; end_at integer;
BEGIN
 needle:=E'  v_attempt INTEGER := 0;\nBEGIN';
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'reentry114_declare_drift';END IF;
 definition:=replace(definition,needle,E'  v_attempt INTEGER := 0;\n  v_canonical_seat RECORD;\nBEGIN');
 start_at:=strpos(definition,'  IF p_draw_mode = ''fill_lowest_table'' THEN');
 end_at:=strpos(definition,E'  BEGIN\n    INSERT INTO public.tournament_seats');
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'reentry114_allocator_drift';END IF;
 replacement:=$new$  IF p_starting_stack IS NULL OR p_starting_stack<=0 THEN
    RETURN jsonb_build_object('ok',false,'error','starting_stack_missing');END IF;
  SELECT * INTO v_canonical_seat FROM floor_private.pick_cashier_canonical_seat_v1(p_tournament_id,p_draw_mode);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','no_table_available');END IF;
  v_table_tour_id:=v_canonical_seat.logical_id;v_table_game_id:=v_canonical_seat.physical_id;
  v_table_number:=v_canonical_seat.number;v_max_seats:=v_canonical_seat.capacity;v_seat_number:=v_canonical_seat.seat;

$new$;
 definition:=substr(definition,1,start_at-1)||replacement||substr(definition,end_at);
 needle:='      chip_count, is_active, player_name, status, assigned_by, assigned_at';
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'reentry114_columns_drift';END IF;
 definition:=replace(definition,needle,needle||', tournament_table_id, table_session_id');
 needle:='      p_starting_stack, true, v_name, ''active'', p_actor_user_id, now()';
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'reentry114_values_drift';END IF;
 definition:=replace(definition,needle,needle||', v_table_tour_id, v_canonical_seat.session_id');
 needle:='      ''from_entry_id'', p_source_entry_id';
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'reentry114_audit_drift';END IF;
 definition:=replace(definition,needle,needle||E',\n      ''to_tournament_table_id'',v_table_tour_id,''destination_session_id'',v_canonical_seat.session_id,\n      ''receipt_code'',v_receipt_code,''chip_count_at_move'',p_starting_stack');
 needle:=E'  UPDATE public.tournaments\n  SET players_remaining';
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'reentry114_revision_drift';END IF;
 definition:=replace(definition,needle,E'  UPDATE public.table_sessions SET revision=revision+1 WHERE id=v_canonical_seat.session_id;\n\n'||needle);
 EXECUTE definition;
END;
$patch$;
COMMIT;
