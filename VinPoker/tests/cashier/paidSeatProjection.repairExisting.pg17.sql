-- Exact LOCAL browser fixture repair, NOT a production migration/backfill.
-- Default is rehearsal/ROLLBACK. Runner's explicit commit option is required.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $$
DECLARE e public.tournament_entries%ROWTYPE; s public.tournament_seats%ROWTYPE;
 r public.tournament_registrations%ROWTYPE; h public.seat_assignment_history%ROWTYPE;
 ticket public.seat_draw_receipts%ROWTYPE; prior jsonb; after_money text; projection bigint;
 money text; unchanged text; repaired integer;
BEGIN
 IF current_user<>'postgres' OR current_database()<>'vinpoker_ops_cash115_qualified_c'
  OR inet_server_port()<>55441 OR host(inet_server_addr())<>'127.0.0.1'
  OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
  OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
  RAISE EXCEPTION 'isolated_native_only'; END IF;
 -- This exact local maintenance transaction excludes concurrent writers while
 -- evaluating the no-subsequent-activity evidence. Never run globally on live.
 LOCK TABLE public.tournaments,public.tournament_registrations,public.game_tables,
  public.table_sessions,public.tournament_tables,public.tournament_entries,
  public.tournament_seats,public.tournament_chip_counts,public.seat_draw_receipts,
  public.seat_assignment_history,public.floor_pending_tracker_moves,
  public.tournament_hands,public.cashier_buyin_movements,public.audit_logs
  IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT e FROM public.tournament_entries WHERE id='80680722-d93c-4fdb-b01f-db2390e979ee';
 SELECT * INTO STRICT r FROM public.tournament_registrations WHERE id=e.registration_id;
 SELECT * INTO STRICT s FROM public.tournament_seats WHERE entry_id=e.id;
 SELECT * INTO STRICT h FROM public.seat_assignment_history WHERE entry_id=e.id;
 SELECT * INTO STRICT ticket FROM public.seat_draw_receipts WHERE entry_id=e.id;
 IF coalesce(e.tournament_id<>'b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f'
  OR e.player_id<>'065801a0-565e-4bd6-9c2d-ee252b7e6494' OR e.entry_no<>1
  OR e.status<>'seated' OR e.current_stack<>20000 OR e.created_at<>e.updated_at
  OR e.busted_at IS NOT NULL OR e.finished_place IS NOT NULL
  OR r.id<>'20116ca5-c1e9-4de6-94fe-24b77efa9cd0' OR r.status<>'confirmed'
  OR r.club_id<>'9ef80c7a-cb97-4acc-b81c-5bf34d49317f'
  OR r.tournament_id<>e.tournament_id OR r.player_id<>e.player_id OR r.cashier_paid_at IS NULL
  OR s.id<>e.seat_id OR NOT s.is_active OR s.status<>'active' OR s.chip_count<>20000
  OR s.player_id<>e.player_id OR s.entry_number<>1 OR s.tournament_id<>e.tournament_id
  OR s.seat_number<>e.seat_number OR s.created_at<>h.created_at OR s.assigned_at<>h.created_at
  OR s.table_session_id<>'3aed91b3-332f-4868-999b-e709e576ed50'
  OR h.reason<>'initial_draw' OR h.draw_type<>'initial' OR h.from_table_id IS NOT NULL
  OR h.to_table_id<>e.table_id OR h.to_seat_number<>e.seat_number
  OR h.metadata->>'chip_count_at_move'<>'20000'
  OR h.metadata->>'registration_id'<>r.id::text
  OR h.metadata->>'destination_session_id'<>s.table_session_id::text
  OR h.metadata->>'to_tournament_table_id'<>s.tournament_table_id::text
  OR ticket.status<>'issued' OR ticket.draw_type<>'initial' OR ticket.seat_id<>s.id
  OR ticket.receipt_code<>'T31-S3-412CDB' OR ticket.registration_id<>r.id
  OR ticket.player_id<>e.player_id OR ticket.table_id<>e.table_id
  OR ticket.seat_number<>e.seat_number OR ticket.issued_at<>h.created_at
  OR EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=e.tournament_id AND player_id=e.player_id AND id<>e.id)
  OR EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=e.tournament_id)
  OR EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves WHERE entry_id=e.id)
  OR NOT EXISTS(SELECT 1 FROM public.tournament_tables t JOIN public.table_sessions ts ON ts.id=t.table_session_id
   WHERE t.id=s.tournament_table_id AND t.status='active' AND t.tournament_id=e.tournament_id
    AND ts.id=s.table_session_id AND ts.closed_at IS NULL AND ts.game_table_id=e.table_id
    AND ts.tournament_id=e.tournament_id AND ts.club_id=r.club_id)
  OR (SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id=r.id)<>1
  OR NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE registration_id=r.id
   AND direction='in' AND purpose='buyin' AND method='cash' AND applied_amount=100000 AND amount=100000)
 ,true) THEN RAISE EXCEPTION 'existing_projection_repair_evidence_changed'; END IF;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'')) INTO money FROM public.cashier_buyin_movements m;
 unchanged:=md5(jsonb_build_array(to_jsonb(e),to_jsonb(s),to_jsonb(r),to_jsonb(h),to_jsonb(ticket))::text);
 SELECT payload INTO prior FROM public.audit_logs WHERE action='local_paid_projection_repair'
  AND entity_id=e.id AND payload->>'repair_key'='single-day-browser-projection139';
 IF (SELECT count(*) FROM public.audit_logs WHERE action='local_paid_projection_repair'
  AND entity_id=e.id AND payload->>'repair_key'='single-day-browser-projection139')>1 THEN
  RAISE EXCEPTION 'existing_projection_repair_duplicate_audit'; END IF;
 SELECT chip_count INTO projection FROM public.tournament_chip_counts
  WHERE tournament_id=e.tournament_id AND player_id=e.player_id AND entry_number=1;
 IF prior IS NOT NULL THEN
  IF projection IS DISTINCT FROM 20000 OR (prior->>'evidence_fingerprint') IS DISTINCT FROM unchanged THEN
   RAISE EXCEPTION 'existing_projection_repair_replay_conflict'; END IF;
 ELSE
  IF projection IS NOT NULL OR EXISTS(SELECT 1 FROM public.tournament_chip_counts
   WHERE tournament_id=e.tournament_id AND player_id=e.player_id AND entry_number=1) THEN
   RAISE EXCEPTION 'existing_projection_repair_would_overwrite'; END IF;
  INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
   VALUES(e.tournament_id,e.player_id,1,20000);
  INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
   VALUES(r.club_id,e.player_id,'local_paid_projection_repair','tournament_entry',e.id,
    jsonb_build_object('repair_key','single-day-browser-projection139','local_only',true,
     'evidence_fingerprint',unchanged,'initial_seat_history',to_jsonb(h),
     'before_projection',null,'after_projection',20000,'receipt_id',ticket.id,
     'reason','Initialize missing generation projection; no chip issuance or money mutation'));
 END IF;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'')) INTO after_money FROM public.cashier_buyin_movements m;
 IF after_money IS DISTINCT FROM money THEN RAISE EXCEPTION 'existing_projection_repair_money_changed'; END IF;
 PERFORM set_config('request.jwt.claim.sub',e.player_id::text,true);
 prior:=public.get_tournament_participation_v1(e.tournament_id)->'counts';
 IF prior->>'seated'<>'1' OR prior->>'anomaly_seats'<>'0' OR prior->>'seated_stack'<>'20000' THEN
  RAISE EXCEPTION 'existing_projection_repair_postcheck_failed: %',prior; END IF;
 RAISE NOTICE 'EXACT_LOCAL_PROJECTION_REPAIR_POSTCHECK_PASS %',prior;
END $$;
-- LOCAL_REPAIR_END
ROLLBACK;
