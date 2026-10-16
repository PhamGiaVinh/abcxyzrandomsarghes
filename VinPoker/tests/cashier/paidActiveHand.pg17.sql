\set ON_ERROR_STOP on
BEGIN;
\if :PAID_MOVE_CASE
SELECT set_config('test.paid_move','true',true);
\else
SELECT set_config('test.paid_move','false',true);
\endif
SELECT set_config('test.paid_registration',:'PAID_REGISTRATION',true);
SELECT set_config('test.paid_correction',:'PAID_CORRECTION_CASE',true);
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_setting('server_version_num')::int/10000<>17
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'isolated_paid_active_hand_required';END IF;
END $$;
DO $$ DECLARE original public.tournament_registrations%ROWTYPE; actor uuid; dest record; empty_table record;
 player uuid; reg uuid; r jsonb; intent jsonb; hand uuid; rev bigint; epoch bigint; button integer;
 finish_intent jsonb; finish_receipt jsonb; money_before jsonb; mode_request uuid;
 moving_player uuid; moving_reg uuid; moving_entry uuid; opened jsonb; src record; target_seat integer;
 correction_alert uuid; alert_status text; correction_unknown_session boolean;
 expected_public_roster jsonb; public_hand jsonb; public_history jsonb;
BEGIN
 SELECT * INTO STRICT original FROM public.tournament_registrations WHERE id=current_setting('test.paid_registration')::uuid;
 SELECT owner_id INTO STRICT actor FROM public.clubs WHERE id=original.club_id;
 SELECT t.id,t.table_session_id INTO STRICT dest FROM public.tournament_tables t JOIN public.tournament_seats s ON s.tournament_table_id=t.id
  JOIN public.tournament_entries e ON e.id=s.entry_id WHERE e.registration_id=original.id AND s.is_active;
 SELECT t.id,t.game_table_id,s.revision INTO STRICT empty_table FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
  WHERE t.tournament_id=original.tournament_id AND t.status='active' AND t.id<>dest.id;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.close_tournament_table_v4(empty_table.id,empty_table.revision,gen_random_uuid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'empty_table_close_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 -- Add the second player via real registration/cash; only one open table, so
 -- both canonical seats form the actual hand roster, not a hand INSERT fixture.
 player:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(player);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 r:=public.cashier_create_app_registration_v1(original.tournament_id,player);reg:=(r->>'registration_id')::uuid;
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'second_registration_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);PERFORM set_config('role','authenticated',true);
 intent:=jsonb_build_object('actor_id',actor,'club_id',original.club_id,'tournament_id',original.tournament_id,'registration_id',reg,'amount',100000,'request_id',gen_random_uuid());
 r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');
 IF r->>'status'<>'recorded' OR r->'result'->>'seating_state'<>'seated' THEN RAISE EXCEPTION 'second_paid_seating_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=dest.table_session_id;
 SELECT min(seat_number) INTO button FROM public.tournament_seats WHERE table_session_id=dest.table_session_id AND is_active;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_start_tournament_clock(original.tournament_id);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'canonical_clock_start_failed: %',r;END IF;
 r:=public.floor_request_table_control_mode_v4(dest.id,dest.table_session_id,'tracker',rev,epoch,gen_random_uuid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'occupied_table_mode_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=dest.table_session_id;
 PERFORM set_config('role','authenticated',true);
 r:=public.start_tracker_hand_v3(original.tournament_id,dest.id,dest.table_session_id,epoch,1,now(),actor,button);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'canonical_hand_start_failed: %',r;END IF;
 hand:=(r->>'hand_id')::uuid;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*)=2 AND sum(starting_stack)=40000 FROM public.hand_players WHERE hand_id=hand) IS NOT TRUE THEN
  RAISE EXCEPTION 'paid_roster_not_frozen_correctly';END IF;
 -- Third player pays during the actual in-progress hand.
 player:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(player);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 r:=public.cashier_create_app_registration_v1(original.tournament_id,player);reg:=(r->>'registration_id')::uuid;
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'third_registration_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);PERFORM set_config('role','authenticated',true);
 intent:=jsonb_build_object('actor_id',actor,'club_id',original.club_id,'tournament_id',original.tournament_id,'registration_id',reg,'amount',100000,'request_id',gen_random_uuid());
 r:=public.resolve_cashier_cash_buyin_intent_v1(intent,'record');
 IF r->>'status'<>'recorded' OR r->'result'->>'seating_state'<>'waiting' THEN RAISE EXCEPTION 'mid_hand_paid_player_not_waiting: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=reg) THEN RAISE EXCEPTION 'mid_hand_cash_created_entry';END IF;
 IF (SELECT count(*)=2 AND sum(starting_stack)=40000 FROM public.hand_players WHERE hand_id=hand) IS NOT TRUE
 OR (SELECT count(*)=2 AND sum(chip_count)=40000 FROM public.tournament_seats WHERE table_session_id=dest.table_session_id AND is_active) IS NOT TRUE THEN
  RAISE EXCEPTION 'mid_hand_payment_changed_roster_or_chips';END IF;
 IF (SELECT count(*)=1 AND sum(amount)=100000 FROM public.cashier_buyin_movements WHERE registration_id=reg) IS NOT TRUE THEN RAISE EXCEPTION 'mid_hand_payment_not_once';END IF;
 IF current_setting('test.paid_move')='true' THEN
  PERFORM set_config('role','authenticated',true);
  opened:=public.floor_open_tournament_table_v3(original.tournament_id,empty_table.game_table_id,'manual',gen_random_uuid());
  IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'move_source_reopen_failed: %',opened;END IF;
  PERFORM set_config('role','none',true);
  moving_player:=gen_random_uuid();INSERT INTO auth.users(id) VALUES(moving_player);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
  r:=public.cashier_create_app_registration_v1(original.tournament_id,moving_player);moving_reg:=(r->>'registration_id')::uuid;
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'moving_registration_failed: %',r;END IF;
  PERFORM set_config('role','none',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);PERFORM set_config('role','authenticated',true);
  r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id',actor,'club_id',original.club_id,'tournament_id',original.tournament_id,
   'registration_id',moving_reg,'amount',100000,'request_id',gen_random_uuid()),'record');
  IF r->>'status'<>'recorded' OR r->'result'->>'seating_state'<>'seated' THEN RAISE EXCEPTION 'moving_paid_source_seat_failed: %',r;END IF;
  moving_entry:=(r->'result'->>'entry_id')::uuid;
  PERFORM set_config('role','none',true);
  SELECT s.tournament_table_id,t.revision,t.control_epoch,s.table_session_id INTO STRICT src
   FROM public.tournament_seats s JOIN public.table_sessions t ON t.id=s.table_session_id WHERE s.entry_id=moving_entry AND s.is_active;
  IF src.table_session_id=dest.table_session_id THEN RAISE EXCEPTION 'moving_player_joined_hand_early';END IF;
  SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=dest.table_session_id;
  SELECT n INTO target_seat FROM generate_series(1,9) n WHERE NOT EXISTS(
   SELECT 1 FROM public.tournament_seats s WHERE s.table_session_id=dest.table_session_id AND s.is_active AND s.seat_number=n) ORDER BY n LIMIT 1;
  PERFORM set_config('role','authenticated',true);
  r:=public.move_player_seat_v5(moving_entry,src.tournament_table_id,src.table_session_id,dest.id,dest.table_session_id,
   target_seat,src.revision,rev,src.control_epoch,epoch,'Paid source safe-boundary TEST',gen_random_uuid());
  IF r->>'queued' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_source_move_not_queued: %',r;END IF;
  PERFORM set_config('role','none',true);
  IF (SELECT count(*) FROM public.tournament_seats WHERE entry_id=moving_entry AND is_active AND table_session_id=src.table_session_id AND chip_count=20000)<>1 THEN
   RAISE EXCEPTION 'queued_move_removed_paid_source_early';END IF;
 END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO money_before FROM public.cashier_buyin_movements m WHERE registration_id=reg;
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=dest.table_session_id;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_request_table_control_mode_v4(dest.id,dest.table_session_id,'manual',rev,epoch,gen_random_uuid());
 IF r->>'outcome' IS DISTINCT FROM 'pending' OR NOT(r->'blockers' ? 'active_hand') THEN RAISE EXCEPTION 'mode_not_waiting_for_actual_hand: %',r;END IF;
 IF current_setting('test.paid_move')='true' AND NOT(r->'blockers' ? 'pending_move') THEN RAISE EXCEPTION 'mode_missing_paid_pending_move_blocker: %',r;END IF;
 r:=public.floor_get_table_control_mode_request_v1(dest.id,dest.table_session_id);
 mode_request:=(r->'request'->>'id')::uuid;
 IF mode_request IS NULL THEN RAISE EXCEPTION 'pending_mode_read_missing';END IF;
 r:=public.floor_cancel_table_control_mode_request_v1(dest.id,dest.table_session_id,mode_request);
 IF r->>'outcome' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'mode_cancel_failed: %',r;END IF;
 IF public.floor_cancel_table_control_mode_request_v1(dest.id,dest.table_session_id,mode_request) IS DISTINCT FROM r THEN
  RAISE EXCEPTION 'mode_cancel_not_idempotent';END IF;
 r:=public.floor_get_table_control_mode_request_v1(dest.id,dest.table_session_id);
 IF r->'request' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'cancelled_mode_still_pending: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=dest.table_session_id AND control_mode='tracker' AND control_epoch=epoch) THEN
  RAISE EXCEPTION 'mode_cancel_changed_current_control';END IF;
 SELECT revision INTO rev FROM public.table_sessions WHERE id=dest.table_session_id;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_request_table_control_mode_v4(dest.id,dest.table_session_id,'manual',rev,epoch,gen_random_uuid());
 IF r->>'outcome' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'mode_rerequest_not_pending: %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT jsonb_build_object('actor_id',actor,'request_id',gen_random_uuid(),'tournament_id',hh.tournament_id,
  'tournament_table_id',dest.id,'hand_id',hand,'table_session_id',dest.table_session_id,'control_epoch',epoch,'source_revision',hh.source_revision,
  'payload',jsonb_build_object('hand_time',now(),'players',(SELECT jsonb_agg(jsonb_build_object(
   'player_id',hp.player_id,'entry_number',hp.entry_number,'seat_number',hp.seat_number,
   'starting_stack',hp.starting_stack,'ending_stack',hp.starting_stack,'is_eliminated',false)) FROM public.hand_players hp WHERE hp.hand_id=hand),
   'actions','[]'::jsonb,'side_pots','[]'::jsonb,'community_cards','[]'::jsonb,'pot_size',0)) INTO finish_intent
 FROM public.tournament_hands hh WHERE hh.id=hand;
 PERFORM set_config('role','authenticated',true);
 finish_receipt:=public.record_tracker_manual_hand_v1(finish_intent);
 IF finish_receipt->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'canonical_finish_failed: %',finish_receipt;END IF;
 PERFORM set_config('role','none',true);
 SET CONSTRAINTS ALL IMMEDIATE;
 IF current_setting('test.paid_move')='true' THEN
  IF (SELECT count(*) FROM public.floor_pending_tracker_moves WHERE entry_id=moving_entry AND status='applied')<>1
   OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id=moving_entry AND is_active AND table_session_id=dest.table_session_id AND chip_count=20000)<>1 THEN
   RAISE EXCEPTION 'paid_pending_move_not_applied_once_before_mode';END IF;
  PERFORM set_config('role','authenticated',true);
  r:=public.get_floor_seat_ticket_v1(original.tournament_id,moving_entry,(SELECT receipt_code FROM public.seat_draw_receipts
   WHERE entry_id=moving_entry AND status IN ('issued','printed') AND cancelled_at IS NULL ORDER BY issued_at DESC LIMIT 1));
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_moved_ticket_proof_failed: %',r;END IF;
  PERFORM set_config('role','none',true);
 END IF;
 IF (SELECT status FROM public.tournament_hands WHERE id=hand)<>'completed'
 OR NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=dest.table_session_id AND control_mode='manual' AND control_epoch=epoch+1) THEN
  RAISE EXCEPTION 'finish_did_not_apply_pending_mode_at_boundary';END IF;
 PERFORM set_config('role','authenticated',true);
 IF public.get_tracker_manual_finish_receipt_v1(finish_intent) IS DISTINCT FROM finish_receipt
 OR public.record_tracker_manual_hand_v1(finish_intent) IS DISTINCT FROM finish_receipt THEN RAISE EXCEPTION 'finish_receipt_not_replayable_after_mode';END IF;
 r:=public.start_tracker_hand_v3(original.tournament_id,dest.id,dest.table_session_id,epoch,2,now(),actor,button);
 IF r->>'error' IS DISTINCT FROM 'STALE_TRACKER_CONTEXT' THEN RAISE EXCEPTION 'stale_tracker_not_fenced_after_mode: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.tournament_hands WHERE tournament_id=original.tournament_id)<>1 THEN
  RAISE EXCEPTION 'old_controller_created_another_hand';END IF;
 IF current_setting('test.paid_correction')='true' THEN
  FOREACH correction_unknown_session IN ARRAY ARRAY[false,true] LOOP
  BEGIN
   -- Explicit legacy-state injection, NOT the report RPC/UI: a real completed
   -- hand has an unresolved alert without a Voice config. Mode already treats
   -- this as a blocker; allocation must fail closed on the same persisted truth.
   IF EXISTS(SELECT 1 FROM public.tracker_voice_configs WHERE tournament_table_id=dest.id) THEN RAISE EXCEPTION 'legacy_alert_fixture_requires_no_voice_config';END IF;
   IF correction_unknown_session THEN
    -- Legacy identity fixture only; actual Finish above remains canonical.
    UPDATE public.tournament_hands SET table_session_id=NULL WHERE id=hand;
   END IF;
   INSERT INTO public.tracker_floor_alerts(club_id,tournament_id,tournament_table_id,physical_table_id,hand_id,reported_by,
    alert_kind,priority,correction_required,title,message,request_id,source_revision)
   SELECT original.club_id,original.tournament_id,dest.id,t.game_table_id,hand,actor,'wrong_action','high',true,
    'Legacy correction TEST','Unresolved legacy correction without Voice config',gen_random_uuid(),h.source_revision
   FROM public.tournament_tables t JOIN public.tournament_hands h ON h.id=hand WHERE t.id=dest.id RETURNING id INTO correction_alert;
   FOREACH alert_status IN ARRAY ARRAY['open','acknowledged','in_progress'] LOOP
    UPDATE public.tracker_floor_alerts SET status=alert_status WHERE id=correction_alert;
    r:=public.cashier_try_seat_paid_v1(reg,actor);
    IF r->>'seating_state' IS DISTINCT FROM 'waiting' THEN RAISE EXCEPTION 'legacy_alert_without_voice_did_not_block_cashier: %',r;END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM public.tournament_entries WHERE registration_id=reg) THEN RAISE EXCEPTION 'correction_blocked_cash_created_entry';END IF;
   -- A bad table must not quarantine another healthy table in the same tour.
   PERFORM set_config('role','authenticated',true);
   opened:=public.floor_open_tournament_table_v3(original.tournament_id,empty_table.game_table_id,'manual',gen_random_uuid());
   IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'healthy_table_positive_open_failed: %',opened;END IF;
   PERFORM set_config('role','none',true);
   r:=public.cashier_try_seat_paid_v1(reg,actor);
   IF r->>'seating_state' IS DISTINCT FROM 'seated' OR r->>'table_id' IS DISTINCT FROM empty_table.game_table_id::text THEN
    RAISE EXCEPTION 'correction_quarantined_healthy_table: %',r;END IF;
   IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE registration_id=reg) IS DISTINCT FROM money_before THEN
    RAISE EXCEPTION 'healthy_table_seating_changed_payment';END IF;
   RAISE SQLSTATE 'PZ001';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;END;
  END LOOP;
 END IF;
 r:=public.cashier_try_seat_paid_v1(reg,actor);
 IF r->>'seating_state' IS DISTINCT FROM 'seated' THEN RAISE EXCEPTION 'paid_waiter_not_seated_after_finish_mode: %',r;END IF;
 IF current_setting('test.paid_move')='true' THEN
  IF (SELECT count(*)=4 AND sum(chip_count)=80000 FROM public.tournament_seats WHERE tournament_id=original.tournament_id AND is_active) IS NOT TRUE THEN
   RAISE EXCEPTION 'paid_move_tour_conservation_failed';END IF;
  IF (SELECT count(*)=4 AND sum(amount)=400000 FROM public.cashier_buyin_movements WHERE tournament_id=original.tournament_id) IS NOT TRUE THEN
   RAISE EXCEPTION 'paid_move_money_conservation_failed';END IF;
 ELSIF (SELECT count(*)=3 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE table_session_id=dest.table_session_id AND is_active) IS NOT TRUE THEN
  RAISE EXCEPTION 'post_hand_paid_seating_count_or_chips_failed';END IF;
 IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE registration_id=reg) IS DISTINCT FROM money_before THEN
  RAISE EXCEPTION 'safe_boundary_seating_changed_money';END IF;
 SELECT jsonb_agg(jsonb_build_object('playerId',hp.player_id,'entryNumber',hp.entry_number,'seatNumber',hp.seat_number,
  'startingStack',hp.starting_stack,'endingStack',hp.ending_stack) ORDER BY hp.player_id::text) INTO expected_public_roster
 FROM public.hand_players hp WHERE hp.hand_id=hand;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true);
 public_hand:=public.get_public_tournament_table_hand_v2(original.tournament_id,dest.id,hand);
 IF public_hand->>'id' IS DISTINCT FROM hand::text OR jsonb_array_length(public_hand->'players')<>2
 OR (SELECT jsonb_agg(jsonb_build_object('playerId',p->'playerId','entryNumber',p->'entryNumber','seatNumber',p->'seatNumber',
  'startingStack',p->'startingStack','endingStack',p->'endingStack') ORDER BY p->>'playerId') FROM jsonb_array_elements(public_hand->'players') p) IS DISTINCT FROM expected_public_roster THEN
  RAISE EXCEPTION 'anonymous_history_used_current_roster_instead_of_frozen_hand: %',public_hand;END IF;
 public_history:=public.get_public_tournament_table_history_v2(original.tournament_id,dest.id,20,NULL,NULL);
 IF jsonb_array_length(public_history->'items')<>1 OR public_history->'items'->0->>'handId' IS DISTINCT FROM hand::text
 OR public_history->'items'->0->'result'->>'status' IS DISTINCT FROM 'pending' THEN
  RAISE EXCEPTION 'anonymous_history_invented_verified_result_or_lost_hand: %',public_history;END IF;
 r:=public.get_public_tournament_table_hand_v2(original.tournament_id,empty_table.id,hand);
 IF r->>'error' IS DISTINCT FROM 'hand_out_of_scope' THEN RAISE EXCEPTION 'anonymous_history_cross_table_link_accepted: %',r;END IF;
 PERFORM set_config('role','none',true);
END $$;
ROLLBACK;
SELECT 'ACTUAL_HAND_PAID_WAIT_FINISH_PENDING_MODE_THEN_SEAT_PASS';
