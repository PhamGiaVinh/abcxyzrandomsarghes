-- Experimental owned-clone DDL only. NOT a release migration.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_manual_card75_20261014' OR current_user<>'postgres'
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55464
 OR md5(pg_get_functiondef('public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)'::regprocedure))
  <>'53374e21fe6d323affa8a074402f4b85'
 THEN RAISE EXCEPTION 'owned_manual_card_dependency_required'; END IF;
END $$;
CREATE TABLE floor_private.manual_card_receipts_prototype (
 actor_id uuid NOT NULL, request_key text NOT NULL, request_hash text NOT NULL,
 response jsonb NOT NULL, PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE floor_private.manual_card_receipts_prototype ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.manual_card_receipts_prototype FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.manual_cards_prototype(
 p_hand_id uuid,p_session_id uuid,p_epoch bigint,p_revision bigint,p_request_key text,p_cards jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); v_request_hash text; receipt jsonb; h public.tournament_hands%ROWTYPE;
 tt public.tournament_tables%ROWTYPE; s public.table_sessions%ROWTYPE; club uuid; physical uuid;
 assignment_count integer; valid_assignment integer; verdict jsonb;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' THEN
  RETURN jsonb_build_object('error','unauthenticated'); END IF;
 IF p_hand_id IS NULL OR p_session_id IS NULL OR p_epoch IS NULL OR p_epoch<1
 OR p_revision IS NULL OR p_revision<0 OR p_request_key IS NULL
 OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$'
 OR jsonb_typeof(p_cards) IS DISTINCT FROM 'array' THEN
  RETURN jsonb_build_object('error','manual_card_context_required'); END IF;
 IF jsonb_array_length(p_cards)=0 THEN RETURN jsonb_build_object('error','manual_card_context_required'); END IF;
 v_request_hash:=encode(extensions.digest(jsonb_build_array(actor,p_hand_id,p_session_id,
  p_epoch,p_revision,p_cards)::text,'sha256'),'hex');
 IF NOT pg_try_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_key,75)) THEN
  RETURN jsonb_build_object('error','manual_card_request_busy'); END IF;
 SELECT * INTO h FROM public.tournament_hands WHERE id=p_hand_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','hand_scope_mismatch'); END IF;
 SELECT * INTO tt FROM public.tournament_tables WHERE id=h.table_id;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=h.tournament_id AND t.deleted_at IS NULL;
 physical:=coalesce(tt.game_table_id,tt.table_id);
 IF club IS NULL OR physical IS NULL THEN RETURN jsonb_build_object('error','hand_scope_mismatch'); END IF;
 -- Physical-before-session ordering; all lifecycle locks are non-blocking.
 PERFORM 1 FROM public.game_tables g WHERE g.id=physical AND g.club_id=club FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','hand_scope_mismatch'); END IF;
 SELECT * INTO s FROM public.table_sessions WHERE id=p_session_id FOR SHARE NOWAIT;
 SELECT * INTO tt FROM public.tournament_tables WHERE id=h.table_id FOR SHARE NOWAIT;
 IF s.id IS NULL OR s.closed_at IS NOT NULL OR s.club_id IS DISTINCT FROM club
 OR s.game_table_id IS DISTINCT FROM physical OR s.tournament_id IS DISTINCT FROM h.tournament_id
 OR s.control_mode IS DISTINCT FROM 'tracker' OR s.control_epoch IS DISTINCT FROM p_epoch
 OR tt.table_session_id IS DISTINCT FROM p_session_id OR tt.tournament_id IS DISTINCT FROM h.tournament_id
 OR coalesce(tt.game_table_id,tt.table_id) IS DISTINCT FROM physical
 OR tt.status IS DISTINCT FROM 'active' THEN RETURN jsonb_build_object('error','stale_manual_card_context'); END IF;
 IF NOT public.is_club_tracker(actor,club) THEN
  SELECT count(*) INTO assignment_count FROM public.dealer_assignments a
   WHERE a.table_id=physical AND a.status='assigned' AND a.released_at IS NULL;
  IF assignment_count<>1 THEN RETURN jsonb_build_object('error','dealer_assignment_invalid'); END IF;
  PERFORM 1 FROM public.dealer_assignments a JOIN public.dealers d ON d.id=a.dealer_id
   JOIN public.dealer_attendance attendance ON attendance.id=a.attendance_id
   WHERE a.table_id=physical AND a.status='assigned' AND a.released_at IS NULL
   FOR SHARE OF a,d,attendance NOWAIT;
  SELECT count(*) INTO valid_assignment FROM public.dealer_assignments a JOIN public.dealers d ON d.id=a.dealer_id
   JOIN public.dealer_attendance attendance ON attendance.id=a.attendance_id
   WHERE a.table_id=physical AND a.table_session_id=p_session_id AND a.club_id=club
    AND a.status='assigned' AND a.released_at IS NULL AND d.club_id=club
    AND d.user_id=actor AND d.deleted_at IS NULL AND attendance.dealer_id=d.id
    AND attendance.status='checked_in' AND attendance.check_out_time IS NULL
    AND attendance.current_state IN ('assigned','on_break');
  IF valid_assignment<>1 THEN RETURN jsonb_build_object('error','actor_not_allowed'); END IF;
 END IF;
 SELECT * INTO h FROM public.tournament_hands WHERE id=p_hand_id FOR UPDATE NOWAIT;
 IF h.tournament_id IS DISTINCT FROM tt.tournament_id
 OR h.table_session_id IS DISTINCT FROM p_session_id OR h.tournament_table_id IS DISTINCT FROM tt.id
 OR h.table_id IS DISTINCT FROM tt.id OR h.status<>'in_progress' OR h.is_voided
 THEN RETURN jsonb_build_object('error','stale_manual_card_context'); END IF;
 -- Mutation replay requires current authority and lifecycle, but precedes revision
 -- CAS because the original successful write has already advanced that revision.
 SELECT r.response INTO receipt FROM floor_private.manual_card_receipts_prototype r
 WHERE r.actor_id=actor AND r.request_key=p_request_key;
 IF FOUND THEN
  IF EXISTS(SELECT 1 FROM floor_private.manual_card_receipts_prototype r WHERE r.actor_id=actor
    AND r.request_key=p_request_key AND r.request_hash=v_request_hash) THEN RETURN receipt; END IF;
  RETURN jsonb_build_object('error','idempotency_conflict');
 END IF;
 IF h.source_revision IS DISTINCT FROM p_revision THEN
  RETURN jsonb_build_object('error','stale_manual_card_context'); END IF;
 -- Shared writer owns deck validation, exact entry, lock ownership and revision.
 verdict:=public._tracker_card_hole_source_v1(p_hand_id,p_cards,actor,false);
 IF verdict->>'status' IS DISTINCT FROM 'success' THEN RETURN verdict; END IF;
 IF (verdict->>'entry_count')::integer<>jsonb_array_length(p_cards) THEN
  RAISE EXCEPTION 'manual_card_writer_result_mismatch'; END IF;
 verdict:=verdict||jsonb_build_object('hand_id',p_hand_id,'table_session_id',p_session_id,
  'control_epoch',p_epoch,'request_key',p_request_key);
 INSERT INTO floor_private.manual_card_receipts_prototype VALUES(actor,p_request_key,v_request_hash,verdict);
 RETURN verdict;
EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('error','manual_card_context_busy');
END $$;
REVOKE ALL ON FUNCTION floor_private.manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION floor_private.manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb) TO authenticated;
CREATE FUNCTION public.show_manual_cards_prototype(
 p_hand_id uuid,p_session_id uuid,p_epoch bigint,p_revision bigint,p_request_key text,p_cards jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
RETURN floor_private.manual_cards_prototype($1,$2,$3,$4,$5,$6);
REVOKE ALL ON FUNCTION public.show_manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.show_manual_cards_prototype(uuid,uuid,bigint,bigint,text,jsonb) TO authenticated;
-- Reconciliation is read-only and actor-bound; it proves a past commit, not
-- current permission to write into that hand/session.
CREATE FUNCTION floor_private.manual_card_receipt_prototype(p_request_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); receipt jsonb; request_hash text;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' THEN
  RETURN jsonb_build_object('error','unauthenticated'); END IF;
 SELECT r.response,r.request_hash INTO receipt,request_hash FROM floor_private.manual_card_receipts_prototype r
 WHERE r.actor_id=actor AND r.request_key=p_request_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 RETURN jsonb_build_object('status','committed','request_key',p_request_key,'request_hash',request_hash,
  'hand_id',receipt->'hand_id','table_session_id',receipt->'table_session_id',
  'control_epoch',receipt->'control_epoch','entry_count',receipt->'entry_count');
END $$;
REVOKE ALL ON FUNCTION floor_private.manual_card_receipt_prototype(text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION floor_private.manual_card_receipt_prototype(text) TO authenticated;
CREATE FUNCTION public.get_manual_card_receipt_prototype(p_request_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
RETURN floor_private.manual_card_receipt_prototype(p_request_key);
REVOKE ALL ON FUNCTION public.get_manual_card_receipt_prototype(text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_manual_card_receipt_prototype(text) TO authenticated;
COMMIT;
