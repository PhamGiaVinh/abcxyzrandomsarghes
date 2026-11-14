-- Source-only. Apply only as a reviewed production package with a recovery point.
-- Existing bust, result, payment and hand-history contracts remain unchanged.
-- Rollback: revoke these two new RPC grants and restore the previous frontend.
BEGIN;

CREATE FUNCTION public.get_floor_tournament_table_roster_v7(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(r) || jsonb_build_object('seats',(
  SELECT COALESCE(jsonb_agg(s.value || (
   SELECT jsonb_build_object(
    'seat_id', CASE WHEN count(*)=1 THEN min(t.id::text) END,
    'seat_entry_id', CASE WHEN count(*)=1 THEN min(t.entry_id::text) END)
   FROM public.tournament_seats t
   WHERE t.tournament_id=r.tournament_id AND t.tournament_table_id=r.tournament_table_id
    AND t.table_session_id=r.table_session_id AND t.is_active
    AND t.seat_number=(s.value->>'seat_number')::integer
    AND t.player_id=(s.value->>'player_id')::uuid
  ) ORDER BY (s.value->>'seat_number')::integer),'[]'::jsonb)
  FROM jsonb_array_elements(r.seats) s(value)
 )) ORDER BY r.table_number),'[]'::jsonb)
 FROM public.get_floor_tournament_table_roster_v6(p_tournament_id) r;
$$;

CREATE FUNCTION public.floor_operator_bust_seat_v1(
 p_tournament_id uuid, p_tournament_table_id uuid, p_table_session_id uuid,
 p_seat_id uuid, p_expected_player_id uuid, p_expected_seat_number integer,
 p_expected_seat_entry_id uuid, p_expected_control_epoch bigint,
 p_request_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 actor uuid:=auth.uid(); tour public.tournaments%ROWTYPE;
 tbl public.tournament_tables%ROWTYPE; session public.table_sessions%ROWTYPE;
 seat public.tournament_seats%ROWTYPE; entry public.tournament_entries%ROWTYPE;
 receipt record; fingerprint text; result jsonb; previous_tracker integer;
 revision bigint; remaining integer; linked boolean; before_state jsonb;
BEGIN
 IF actor IS NULL OR p_tournament_id IS NULL OR p_tournament_table_id IS NULL
  OR p_table_session_id IS NULL OR p_seat_id IS NULL OR p_expected_player_id IS NULL
  OR p_expected_seat_number NOT BETWEEN 1 AND 9 OR p_expected_seat_number IS NULL
  OR p_expected_control_epoch IS NULL OR p_request_id IS NULL
  OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_request');
 END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id;
 IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(actor,tour.club_id) THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 fingerprint:=jsonb_build_array(p_tournament_id,p_tournament_table_id,p_table_session_id,
  p_seat_id,p_expected_player_id,p_expected_seat_number,p_expected_seat_entry_id,
  p_expected_control_epoch,p_reason)::text;
 -- Acquire both operation receipts before business locks, matching the legacy writer.
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'floor_operator_bust_seat_v1',p_request_id);
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'floor_bust_player_v3',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'floor_operator_bust_seat_v1',p_request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint<>fingerprint THEN
   RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN receipt.result;
 END IF;
 -- A direct legacy operation may already own this UUID. Never interpret its
 -- receipt as this exact-seat intent, even if its older fingerprint matches.
 PERFORM 1 FROM floor_private.floor_table_v3_existing_receipt(actor,'floor_bust_player_v3',p_request_id);
 IF FOUND THEN RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(actor,tour.club_id) THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 IF tour.status IN ('completed','finished','cancelled') OR tour.deleted_at IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'error','tournament_not_open');
 END IF;
 SELECT * INTO tbl FROM public.tournament_tables WHERE id=p_tournament_table_id
  AND tournament_id=tour.id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','table_session_mismatch'); END IF;
 PERFORM 1 FROM public.game_tables WHERE id=tbl.game_table_id AND club_id=tour.club_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','game_table_scope_mismatch'); END IF;
 SELECT * INTO session FROM public.table_sessions WHERE id=p_table_session_id FOR UPDATE;
 SELECT * INTO tbl FROM public.tournament_tables WHERE id=p_tournament_table_id FOR UPDATE;
 IF session.id IS NULL OR session.closed_at IS NOT NULL OR tbl.status<>'active'
  OR session.tournament_id IS DISTINCT FROM tour.id OR tbl.tournament_id IS DISTINCT FROM tour.id
  OR session.game_table_id IS DISTINCT FROM tbl.game_table_id
  OR tbl.table_session_id IS DISTINCT FROM session.id
  OR session.control_epoch IS DISTINCT FROM p_expected_control_epoch THEN
  RETURN jsonb_build_object('ok',false,'error','table_session_mismatch');
 END IF;
 IF session.redraw_hold_batch_id IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'error','redraw_in_progress');
 END IF;
 IF floor_private.floor_table_v3_has_active_hand(tour.id,tbl.id,session.id) THEN
  RETURN jsonb_build_object('ok',false,'error','player_in_active_hand');
 END IF;
 -- Read identity first; lock entry before seat, as in the canonical bust writer.
 SELECT * INTO seat FROM public.tournament_seats WHERE id=p_seat_id;
 IF seat.id IS NULL OR seat.tournament_id IS DISTINCT FROM tour.id
  OR seat.tournament_table_id IS DISTINCT FROM tbl.id OR seat.table_session_id IS DISTINCT FROM session.id
  OR seat.player_id IS DISTINCT FROM p_expected_player_id OR seat.seat_number IS DISTINCT FROM p_expected_seat_number
  OR seat.entry_id IS DISTINCT FROM p_expected_seat_entry_id THEN
  RETURN jsonb_build_object('ok',false,'error','seat_identity_changed');
 END IF;
 SELECT * INTO entry FROM public.tournament_entries WHERE id=seat.entry_id
  AND tournament_id=tour.id AND player_id=seat.player_id AND entry_no=seat.entry_number FOR UPDATE;
 SELECT * INTO seat FROM public.tournament_seats WHERE id=p_seat_id FOR UPDATE;
 IF seat.id IS NULL OR NOT seat.is_active OR seat.tournament_id IS DISTINCT FROM tour.id
  OR seat.tournament_table_id IS DISTINCT FROM tbl.id OR seat.table_session_id IS DISTINCT FROM session.id
  OR seat.player_id IS DISTINCT FROM p_expected_player_id OR seat.seat_number IS DISTINCT FROM p_expected_seat_number
  OR seat.entry_id IS DISTINCT FROM p_expected_seat_entry_id THEN
  RETURN jsonb_build_object('ok',false,'error','seat_identity_changed');
 END IF;
 linked:=entry.id IS NOT NULL AND entry.tournament_id=tour.id AND entry.player_id=seat.player_id
  AND entry.entry_no=seat.entry_number AND entry.status='seated';
 IF linked AND (SELECT count(*) FROM public.tournament_seats WHERE entry_id=entry.id AND is_active)<>1 THEN
  -- A duplicate placement is cleanup only, never an elimination of both seats.
  linked:=false;
 END IF;
 before_state:=jsonb_build_object('seat_id',seat.id,'entry_id',seat.entry_id,'entry_number',seat.entry_number,
  'seat_chip_count',seat.chip_count,'entry_stack',entry.current_stack,'entry_status',entry.status);
 IF linked THEN
  -- A Floor-confirmed elimination can correct stale Tracker chips, never a running hand.
  -- The canonical writer still owns bust ordering/entry status and all existing triggers.
  BEGIN
   IF session.control_mode='tracker' THEN
    SELECT chip_count INTO previous_tracker FROM public.tournament_chip_counts
     WHERE tournament_id=tour.id AND player_id=entry.player_id AND entry_number=entry.entry_no FOR UPDATE;
    before_state:=before_state || jsonb_build_object('tracker_chip_count',previous_tracker);
    UPDATE public.tournament_seats SET chip_count=0 WHERE id=seat.id;
    INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
     VALUES(tour.id,entry.player_id,entry.entry_no,0)
     ON CONFLICT(tournament_id,player_id,entry_number) DO UPDATE SET chip_count=0,updated_at=now();
   END IF;
   result:=public.floor_bust_player_v3(entry.id,session.revision,session.control_epoch,
    CASE WHEN session.control_mode='tracker' THEN 0 ELSE seat.chip_count END,p_request_id,p_reason);
   IF result->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE='VP001',MESSAGE='canonical_bust_rejected';
   END IF;
   IF result->>'entry_id' IS DISTINCT FROM entry.id::text
    OR result->>'seat_id' IS DISTINCT FROM seat.id::text
    OR result->>'table_session_id' IS DISTINCT FROM session.id::text
    OR result->>'revision' IS DISTINCT FROM (session.revision+1)::text
    OR result->>'payout_applied' IS DISTINCT FROM 'false' THEN
    result:=jsonb_build_object('ok',false,'error','canonical_bust_receipt_mismatch');
    RAISE EXCEPTION USING ERRCODE='VP001',MESSAGE='canonical_bust_rejected';
   END IF;
  EXCEPTION WHEN SQLSTATE 'VP001' THEN
   -- Do not commit a chip correction if the canonical elimination was rejected.
   RETURN result;
  END;
  result:=result || jsonb_build_object('outcome','busted');
 ELSE
  -- An orphan is not a paid entry. Free only this exact seat; do not invent a
  -- registration, alter another player's entry, or fabricate an elimination order.
  UPDATE public.tournament_seats SET is_active=false,status='cancelled' WHERE id=seat.id;
  UPDATE public.table_sessions SET revision=table_sessions.revision+1 WHERE id=session.id RETURNING table_sessions.revision INTO revision;
  SELECT count(*)::integer INTO remaining FROM public.tournament_seats WHERE tournament_id=tour.id AND is_active;
  UPDATE public.tournaments SET players_remaining=remaining WHERE id=tour.id;
  result:=jsonb_build_object('ok',true,'outcome','orphan_seat_released','seat_id',seat.id,
   'entry_id',NULL,'table_session_id',session.id,'revision',revision,'players_remaining',remaining,'payout_applied',false);
 END IF;
 result:=result || jsonb_build_object('before',before_state,'reason',p_reason,'actor_id',actor,'request_id',p_request_id);
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'floor_operator_bust_seat_v1',p_request_id,fingerprint,result);
 RETURN result;
END;
$$;

ALTER FUNCTION public.get_floor_tournament_table_roster_v7(uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_operator_bust_seat_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid,bigint,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_floor_tournament_table_roster_v7(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.floor_operator_bust_seat_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid,bigint,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_tournament_table_roster_v7(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_operator_bust_seat_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid,bigint,uuid,text) TO authenticated;
COMMIT;
