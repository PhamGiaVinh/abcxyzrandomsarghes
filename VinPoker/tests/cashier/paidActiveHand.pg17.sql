\set ON_ERROR_STOP on
BEGIN;
\if :PAID_MOVE_CASE
SELECT set_config('test.paid_move','true',true);
\else
SELECT set_config('test.paid_move','false',true);
\endif
SELECT set_config('test.paid_registration',:'PAID_REGISTRATION',true);
SELECT set_config('test.paid_correction',:'PAID_CORRECTION_CASE',true);
\if :{?PAID_VERIFIED_HAND}
SELECT set_config('test.paid_verified_hand',:'PAID_VERIFIED_HAND',true);
\else
SELECT set_config('test.paid_verified_hand','false',true);
\endif
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_setting('server_version_num')::int/10000<>17
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'isolated_paid_active_hand_required';END IF;
END $$;
DO $$ DECLARE original public.tournament_registrations%ROWTYPE; actor uuid; dest record; empty_table record;
 player uuid; reg uuid; r jsonb; intent jsonb; hand uuid; rev bigint; epoch bigint; button integer;
 finish_intent jsonb; finish_receipt jsonb; money_before jsonb; mode_request uuid;
 moving_player uuid; moving_reg uuid; moving_entry uuid; opened jsonb; src record; target_seat integer;
 move_key uuid:=gen_random_uuid(); move_result jsonb; move_dest_revision bigint; move_dest_epoch bigint;
 close_key uuid:=gen_random_uuid(); close_result jsonb; source_before jsonb;
 correction_alert uuid; alert_status text; correction_unknown_session boolean;
 expected_public_roster jsonb; public_hand jsonb; public_history jsonb;
 tv_token text:='fixture-only-paid-tv-'||gen_random_uuid()::text; tv_payload jsonb; branding boolean; expected_remaining integer;
 flight_b uuid; shared_event uuid:=gen_random_uuid(); physical_b uuid:=gen_random_uuid(); player_b uuid:=gen_random_uuid();
 token_b text:='fixture-only-paid-flight-b-'||gen_random_uuid()::text; payload_b jsonb; registration_b uuid;
 clock_revision_a text; flight_b_before jsonb; paused_a_before jsonb;
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
 IF current_setting('test.paid_verified_hand')='true' THEN
  -- Actual authenticated action endpoint, isolated savepoint: the canonical
  -- Finish below still receives its original clean action list.
  DECLARE action_player record; action_revision bigint; inserted_revision bigint;
   action_key text:='paid-action-endpoint-'||gen_random_uuid(); action_reply jsonb;
   action_id uuid; undo_key uuid:=gen_random_uuid(); undo_reply jsonb; undone_revision bigint;
   test_dealer uuid:=gen_random_uuid(); test_attendance uuid:=gen_random_uuid(); projection_before jsonb; projection_after jsonb;
   card_key text:='paid-manual-card-'||gen_random_uuid(); card_payload jsonb; card_expected jsonb;
   card_reply jsonb; card_receipt jsonb; card_revision bigint;
  BEGIN
   SELECT player_id,entry_number INTO STRICT action_player FROM public.hand_players WHERE hand_id=hand ORDER BY seat_number LIMIT 1;
   SELECT source_revision INTO action_revision FROM public.tournament_hands WHERE id=hand;
   SELECT jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id=original.tournament_id),
    'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id=original.tournament_id),
    'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c WHERE tournament_id=original.tournament_id),
    'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id=original.tournament_id)) INTO projection_before;
   BEGIN
    PERFORM set_config('role','authenticated',true);
    action_reply:=public.record_action(hand,action_player.player_id,'check',1,action_player.entry_number,'preflop',0,action_key,NULL,actor);
    IF action_reply->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'paid_action_endpoint_failed: %',action_reply;END IF;
    PERFORM set_config('role','none',true);
    SELECT source_revision INTO inserted_revision FROM public.tournament_hands WHERE id=hand;
    IF inserted_revision<=action_revision OR (SELECT count(*) FROM public.hand_actions WHERE hand_id=hand AND idempotency_key=action_key)<>1 THEN
     RAISE EXCEPTION 'paid_action_revision_or_count_failed';END IF;
    PERFORM set_config('role','authenticated',true);
    action_reply:=public.record_action(hand,action_player.player_id,'check',1,action_player.entry_number,'preflop',0,action_key,NULL,actor);
    IF action_reply->>'duplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_action_replay_failed: %',action_reply;END IF;
    action_reply:=public.record_action(hand,action_player.player_id,'check',1,action_player.entry_number,'preflop',1,action_key,NULL,actor);
    IF action_reply->>'error' IS DISTINCT FROM 'idempotency_key_conflict' THEN RAISE EXCEPTION 'paid_action_payload_conflict_missing: %',action_reply;END IF;
    action_reply:=public.record_action(hand,action_player.player_id,'check',2,action_player.entry_number,'preflop',0,action_key||'-spoof',NULL,action_player.player_id);
    IF action_reply->>'error' IS DISTINCT FROM 'actor_mismatch' THEN RAISE EXCEPTION 'paid_action_actor_binding_missing: %',action_reply;END IF;
    PERFORM set_config('role','none',true);
    IF (SELECT source_revision FROM public.tournament_hands WHERE id=hand)<>inserted_revision
     OR (SELECT count(*) FROM public.hand_actions WHERE hand_id=hand)<>1 THEN RAISE EXCEPTION 'paid_action_retry_mutated_source';END IF;
    SELECT id INTO STRICT action_id FROM public.hand_actions WHERE hand_id=hand AND idempotency_key=action_key;
    PERFORM set_config('role','authenticated',true);
    undo_reply:=public.undo_tracker_last_action_v1(original.tournament_id,dest.id,hand,action_id,inserted_revision,undo_key);
    IF undo_reply->>'error' IS DISTINCT FROM 'uat_capability_disabled' THEN RAISE EXCEPTION 'paid_undo_without_scope_accepted: %',undo_reply;END IF;
    PERFORM set_config('role','none',true);
    INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled)
     VALUES(original.club_id,original.tournament_id,dest.id,actor,'undo_open_hand',true);
    PERFORM set_config('role','authenticated',true);
    undo_reply:=public.undo_tracker_last_action_v1(original.tournament_id,dest.id,hand,action_id,inserted_revision,undo_key);
    IF undo_reply->>'error' IS DISTINCT FROM 'dealer_assignment_not_unique' THEN RAISE EXCEPTION 'paid_owner_undo_authority_expanded: %',undo_reply;END IF;
    PERFORM set_config('role','none',true);
    IF (SELECT source_revision FROM public.tournament_hands WHERE id=hand)<>inserted_revision
     OR (SELECT count(*) FROM public.hand_actions WHERE hand_id=hand)<>1
     OR EXISTS(SELECT 1 FROM public.tracker_correction_operations WHERE hand_id=hand) THEN RAISE EXCEPTION 'paid_undo_denial_delta';END IF;
    -- Explicit isolated control-plane fixture, not dealer check-in/assignment proof.
    INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES(test_dealer,original.club_id,actor,'Paid undo TEST','active');
    INSERT INTO public.dealer_attendance(id,dealer_id,current_state,status) VALUES(test_attendance,test_dealer,'assigned','checked_in');
    INSERT INTO public.dealer_assignments(dealer_id,attendance_id,table_id,table_session_id,club_id,assigned_at,status)
     SELECT test_dealer,test_attendance,game_table_id,dest.table_session_id,original.club_id,now(),'assigned' FROM public.tournament_tables WHERE id=dest.id;
    PERFORM set_config('role','authenticated',true);
    undo_reply:=public.undo_tracker_last_action_v1(original.tournament_id,empty_table.id,hand,action_id,inserted_revision,undo_key);
    IF undo_reply->>'error' IS DISTINCT FROM 'stale_tracker_context' THEN RAISE EXCEPTION 'paid_undo_wrong_table_accepted: %',undo_reply;END IF;
    undo_reply:=public.undo_tracker_last_action_v1(original.tournament_id,dest.id,hand,action_id,inserted_revision+1,undo_key);
    IF undo_reply->>'error' IS DISTINCT FROM 'stale_source_revision' THEN RAISE EXCEPTION 'paid_undo_stale_revision_accepted: %',undo_reply;END IF;
    undo_reply:=public.undo_tracker_last_action_v1(original.tournament_id,dest.id,hand,action_id,inserted_revision,undo_key);
    IF undo_reply->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_scoped_assigned_undo_failed: %',undo_reply;END IF;
    PERFORM set_config('role','none',true);
    SELECT source_revision INTO undone_revision FROM public.tournament_hands WHERE id=hand;
    IF undone_revision<=inserted_revision OR EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id=hand)
     OR (SELECT count(*) FROM public.tracker_correction_operations WHERE hand_id=hand AND idempotency_key=undo_key)<>1 THEN RAISE EXCEPTION 'paid_undo_revision_or_receipt_failed';END IF;
    PERFORM set_config('role','authenticated',true);
    action_reply:=public.undo_tracker_last_action_v1(original.tournament_id,dest.id,hand,action_id,inserted_revision,undo_key);
    IF action_reply->>'duplicate' IS DISTINCT FROM 'true' OR action_reply-'duplicate' IS DISTINCT FROM undo_reply-'duplicate' THEN
     RAISE EXCEPTION 'paid_undo_replay_failed: %',action_reply;END IF;
    action_reply:=public.undo_tracker_last_action_v1(original.tournament_id,dest.id,hand,action_id,inserted_revision+1,undo_key);
    IF action_reply->>'error' IS DISTINCT FROM 'request_key_conflict' THEN RAISE EXCEPTION 'paid_undo_key_conflict_missing: %',action_reply;END IF;
    PERFORM set_config('role','none',true);
    IF (SELECT source_revision FROM public.tournament_hands WHERE id=hand)<>undone_revision
     OR EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id=hand)
     OR (SELECT count(*) FROM public.tracker_correction_operations WHERE hand_id=hand AND idempotency_key=undo_key)<>1 THEN RAISE EXCEPTION 'paid_undo_retry_delta';END IF;
    IF EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id=hand AND status IN ('pending','processing')) THEN
     RAISE EXCEPTION 'paid_active_undo_became_publishable';END IF;
    card_payload:=jsonb_build_array(jsonb_build_object('player_id',action_player.player_id,'entry_number',action_player.entry_number,'hole_cards',jsonb_build_array('2c','3d')));
    card_expected:=jsonb_build_object('hand_id',hand,'table_session_id',dest.table_session_id,'control_epoch',epoch,
     'expected_source_revision',undone_revision,'player_hole_cards',card_payload);
    PERFORM set_config('role','authenticated',true);
    card_reply:=public.show_tracker_manual_cards_v1(hand,dest.table_session_id,epoch+1,undone_revision,card_key,card_payload);
    IF card_reply->>'error' IS DISTINCT FROM 'stale_manual_card_context' THEN RAISE EXCEPTION 'paid_cards_stale_epoch_accepted: %',card_reply;END IF;
    card_receipt:=public.show_tracker_manual_cards_v1(hand,dest.table_session_id,epoch,undone_revision,card_key,card_payload);
    IF card_receipt->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'paid_cards_write_failed: %',card_receipt;END IF;
    card_reply:=public.show_tracker_manual_cards_v1(hand,dest.table_session_id,epoch,undone_revision,card_key,card_payload);
    IF card_reply IS DISTINCT FROM card_receipt THEN RAISE EXCEPTION 'paid_cards_replay_changed_receipt';END IF;
    card_reply:=public.show_tracker_manual_cards_v1(hand,dest.table_session_id,epoch,undone_revision,card_key,
     jsonb_set(card_payload,'{0,hole_cards}','["4c","5d"]'));
    IF card_reply->>'error' IS DISTINCT FROM 'idempotency_conflict' THEN RAISE EXCEPTION 'paid_cards_conflict_missing: %',card_reply;END IF;
    card_reply:=public.get_tracker_manual_card_receipt_v1(card_key,card_expected);
    IF card_reply->>'status' IS DISTINCT FROM 'committed' OR card_reply->>'request_key' IS DISTINCT FROM card_key
     OR (card_reply->>'expected_source_revision')::bigint IS DISTINCT FROM undone_revision
     OR card_reply->>'hand_id' IS DISTINCT FROM hand::text THEN RAISE EXCEPTION 'paid_cards_receipt_recovery_failed: %',card_reply;END IF;
    PERFORM set_config('role','none',true);
    SELECT source_revision INTO card_revision FROM public.tournament_hands WHERE id=hand;
    IF card_revision<=undone_revision OR (card_reply->>'committed_source_revision')::bigint IS DISTINCT FROM card_revision
     OR (SELECT hole_cards FROM public.hand_players WHERE hand_id=hand AND player_id=action_player.player_id AND entry_number=action_player.entry_number) IS DISTINCT FROM '["2c","3d"]'::jsonb
     OR (SELECT count(*) FROM floor_private.tracker_manual_card_receipts_v1 WHERE actor_id=actor AND request_key=card_key)<>1 THEN
     RAISE EXCEPTION 'paid_cards_revision_or_rows_mismatch';END IF;
    PERFORM set_config('request.jwt.claim.sub',action_player.player_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',action_player.player_id,'role','authenticated')::text,true);
    PERFORM set_config('role','authenticated',true);
    card_reply:=public.get_tracker_manual_card_receipt_v1(card_key,card_expected);
    IF card_reply->>'status' IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'paid_cards_receipt_leaked_other_actor: %',card_reply;END IF;
    card_reply:=public.show_tracker_manual_cards_v1(hand,dest.table_session_id,epoch,card_revision,card_key||'-outsider',card_payload);
    IF card_reply->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'paid_cards_outsider_write_accepted: %',card_reply;END IF;
    PERFORM set_config('role','none',true);
    PERFORM set_config('request.jwt.claim.sub',actor::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    IF (SELECT source_revision FROM public.tournament_hands WHERE id=hand)<>card_revision
     OR (SELECT count(*) FROM floor_private.tracker_manual_card_receipts_v1 WHERE request_key LIKE card_key||'%')<>1 THEN
     RAISE EXCEPTION 'paid_cards_replay_or_denial_delta';END IF;
    SELECT jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id=original.tournament_id),
     'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id=original.tournament_id),
     'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c WHERE tournament_id=original.tournament_id),
     'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id=original.tournament_id)) INTO projection_after;
    IF projection_after IS DISTINCT FROM projection_before THEN RAISE EXCEPTION 'paid_action_undo_changed_cash_or_chip_projections';END IF;
    RAISE SQLSTATE 'PZ002';
   EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;END;
   IF (SELECT source_revision FROM public.tournament_hands WHERE id=hand)<>action_revision
    OR EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id=hand)
    OR EXISTS(SELECT 1 FROM public.tracker_correction_operations WHERE hand_id=hand)
    OR EXISTS(SELECT 1 FROM public.dealers WHERE id=test_dealer)
    OR EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id=test_attendance)
    OR EXISTS(SELECT 1 FROM floor_private.tracker_manual_card_receipts_v1 WHERE actor_id=actor AND request_key=card_key)
    OR EXISTS(SELECT 1 FROM public.tracker_correction_uat_scopes WHERE tournament_id=original.tournament_id AND user_id=actor)
    THEN RAISE EXCEPTION 'paid_action_probe_not_rolled_back';END IF;
  END;
 END IF;
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
  move_dest_revision:=rev;move_dest_epoch:=epoch;
  SELECT n INTO target_seat FROM generate_series(1,9) n WHERE NOT EXISTS(
   SELECT 1 FROM public.tournament_seats s WHERE s.table_session_id=dest.table_session_id AND s.is_active AND s.seat_number=n) ORDER BY n LIMIT 1;
  PERFORM set_config('role','authenticated',true);
  r:=public.move_player_seat_v5(moving_entry,src.tournament_table_id,src.table_session_id,dest.id,dest.table_session_id,
   target_seat,src.revision,rev,src.control_epoch,epoch,'Paid source safe-boundary TEST',move_key);
  IF r->>'queued' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_source_move_not_queued: %',r;END IF;
  move_result:=r;
  r:=public.move_player_seat_v5(moving_entry,src.tournament_table_id,src.table_session_id,dest.id,dest.table_session_id,
   target_seat,src.revision,move_dest_revision,src.control_epoch,move_dest_epoch,'Paid source safe-boundary TEST',move_key);
  IF r IS DISTINCT FROM move_result THEN RAISE EXCEPTION 'queued_move_receipt_replay_changed: %',r;END IF;
  PERFORM set_config('role','none',true);
  IF (SELECT count(*) FROM public.tournament_seats WHERE entry_id=moving_entry AND is_active AND table_session_id=src.table_session_id AND chip_count=20000)<>1 THEN
   RAISE EXCEPTION 'queued_move_removed_paid_source_early';END IF;
  SELECT to_jsonb(s) INTO source_before FROM public.table_sessions s WHERE id=src.table_session_id;
  SELECT revision INTO rev FROM public.table_sessions WHERE id=src.table_session_id;
  PERFORM set_config('role','authenticated',true);
  r:=public.close_tournament_table_v4(src.tournament_table_id,rev,gen_random_uuid());
  IF r->>'error' IS DISTINCT FROM 'table_not_empty' THEN RAISE EXCEPTION 'queued_source_close_not_blocked: %',r;END IF;
  PERFORM set_config('role','none',true);
  IF (SELECT to_jsonb(s) FROM public.table_sessions s WHERE id=src.table_session_id) IS DISTINCT FROM source_before
   OR (SELECT count(*) FROM public.floor_pending_tracker_moves WHERE entry_id=moving_entry AND status='pending')<>1 THEN
   RAISE EXCEPTION 'denied_close_changed_queued_source';END IF;
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
 IF current_setting('test.paid_verified_hand')='true' THEN
  -- Real manual Finish input: SB100 folds to BB200. BB gets uncalled100
  -- back and wins pot200: ending SB19900/BB20100, no invented showdown cards.
  finish_intent:=jsonb_set(finish_intent,'{payload,players}',(SELECT jsonb_agg(jsonb_build_object(
   'player_id',hp.player_id,'entry_number',hp.entry_number,'seat_number',hp.seat_number,'starting_stack',hp.starting_stack,
   'ending_stack',hp.starting_stack+CASE WHEN hp.seat_number=h.tracker_sb_position THEN -100 ELSE 100 END,
   'is_eliminated',false,'hole_cards','[]'::jsonb)) FROM public.hand_players hp JOIN public.tournament_hands h ON h.id=hp.hand_id WHERE hp.hand_id=hand));
  finish_intent:=jsonb_set(finish_intent,'{payload,actions}',(SELECT jsonb_build_array(
   jsonb_build_object('player_id',sb.player_id,'entry_number',sb.entry_number,'street','preflop','action_type','post_sb','action_amount',100,'action_order',1),
   jsonb_build_object('player_id',bb.player_id,'entry_number',bb.entry_number,'street','preflop','action_type','post_bb','action_amount',200,'action_order',2),
   jsonb_build_object('player_id',sb.player_id,'entry_number',sb.entry_number,'street','preflop','action_type','fold','action_amount',0,'action_order',3))
   FROM public.tournament_hands h JOIN public.hand_players sb ON sb.hand_id=h.id AND sb.seat_number=h.tracker_sb_position
    JOIN public.hand_players bb ON bb.hand_id=h.id AND bb.seat_number=h.tracker_bb_position WHERE h.id=hand));
  finish_intent:=jsonb_set(finish_intent,'{payload,pot_size}','200'::jsonb);
 END IF;
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
  -- Lost-response retry keeps the original intent/epoch even after the hand
  -- boundary changed control mode. It must replay, never move a second time.
  PERFORM set_config('role','authenticated',true);
  r:=public.move_player_seat_v5(moving_entry,src.tournament_table_id,src.table_session_id,dest.id,dest.table_session_id,
   target_seat,src.revision,move_dest_revision,src.control_epoch,move_dest_epoch,'Paid source safe-boundary TEST',move_key);
  IF r IS DISTINCT FROM move_result THEN RAISE EXCEPTION 'applied_move_receipt_replay_changed: %',r;END IF;
  r:=public.move_player_seat_v5(moving_entry,src.tournament_table_id,src.table_session_id,dest.id,dest.table_session_id,
   target_seat,src.revision,move_dest_revision,src.control_epoch,move_dest_epoch,'Changed move payload TEST',move_key);
  IF r->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'applied_move_payload_conflict_missing: %',r;END IF;
  PERFORM set_config('role','none',true);
  IF (SELECT count(*) FROM public.floor_pending_tracker_moves WHERE entry_id=moving_entry)<>1
   OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id=moving_entry AND is_active)<>1 THEN
   RAISE EXCEPTION 'move_retry_duplicated_queue_or_seat';END IF;
  -- Exercise the real close writer/replay in a savepoint, then restore the
  -- empty source for the later paid-waiter allocation scenario below.
  SELECT to_jsonb(s) INTO source_before FROM public.table_sessions s WHERE id=src.table_session_id;
  BEGIN
   SELECT revision INTO rev FROM public.table_sessions WHERE id=src.table_session_id;
   PERFORM set_config('role','authenticated',true);
   close_result:=public.close_tournament_table_v4(src.tournament_table_id,rev,close_key);
   IF close_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'applied_move_source_close_failed: %',close_result;END IF;
   IF public.close_tournament_table_v4(src.tournament_table_id,rev,close_key) IS DISTINCT FROM close_result THEN
    RAISE EXCEPTION 'applied_move_source_close_replay_changed';END IF;
   PERFORM set_config('role','none',true);
   IF NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=src.table_session_id AND closed_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.tournament_seats WHERE table_session_id=src.table_session_id AND is_active)
    OR EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves WHERE source_table_session_id=src.table_session_id AND status='pending')
    OR EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id=src.table_session_id AND released_at IS NULL) THEN
    RAISE EXCEPTION 'applied_move_source_close_postcondition_failed';END IF;
   RAISE SQLSTATE 'PZ002';
  EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;END;
  IF (SELECT to_jsonb(s) FROM public.table_sessions s WHERE id=src.table_session_id) IS DISTINCT FROM source_before THEN
   RAISE EXCEPTION 'source_close_probe_not_rolled_back';END IF;
  RAISE NOTICE 'PAID_DEFERRED_MOVE_SOURCE_CLOSE_REPLAY_CONFLICT_ROLLBACK_PASS';
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
 -- Second flight uses real create/levels/open/register/pay/start RPCs. Event
 -- association/layout below is explicit local config, not editor publish proof.
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.create_tournament_with_levels_v1(original.club_id,jsonb_build_object('name','Paid flight B TEST','start_time',now()+interval '1 hour',
  'buy_in',50000,'rake_amount',0,'service_fee_amount',0,'starting_stack',40000,'game_type','nlh','minutes_per_level',30,'late_reg_close_level',6),
  '[{"level_number":1,"small_blind":500,"big_blind":1000,"ante":100,"duration_minutes":30,"is_break":false}]',gen_random_uuid(),actor);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_flight_b_create_failed: %',r;END IF;
 flight_b:=(r->>'tournament_id')::uuid;
 PERFORM set_config('role','none',true);
 INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
 VALUES(physical_b,original.club_id,'Paid flight B table TEST',99,'tournament','inactive','available');
 INSERT INTO auth.users(id) VALUES(player_b);
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_open_tournament_table_v3(flight_b,physical_b,'manual',gen_random_uuid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_flight_b_open_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 r:=public.cashier_create_app_registration_v1(flight_b,player_b);registration_b:=(r->>'registration_id')::uuid;
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_flight_b_registration_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);PERFORM set_config('role','authenticated',true);
 r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id',actor,'club_id',original.club_id,'tournament_id',flight_b,
  'registration_id',registration_b,'amount',50000,'request_id',gen_random_uuid()),'record');
 IF r->>'status'<>'recorded' OR r->'result'->>'seating_state'<>'seated' THEN RAISE EXCEPTION 'paid_flight_b_payment_failed: %',r;END IF;
 r:=public.floor_start_tournament_clock(flight_b);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'paid_flight_b_clock_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*)=1 AND sum(amount)=50000 FROM public.cashier_buyin_movements WHERE registration_id=registration_b) IS NOT TRUE
 OR (SELECT count(*)=1 AND sum(chip_count)=40000 FROM public.tournament_seats WHERE tournament_id=flight_b AND is_active) IS NOT TRUE THEN
  RAISE EXCEPTION 'second_paid_flight_ledger_or_stack_mismatch';END IF;
 INSERT INTO public.tournament_events(id,club_id,name) VALUES(shared_event,original.club_id,'Shared paid event TEST');
 UPDATE public.tournaments SET event_id=shared_event WHERE id IN (original.tournament_id,flight_b);
 INSERT INTO public.tv_tournament_layouts(club_id,event_id,brand_name,layout,updated_by)
 VALUES(original.club_id,shared_event,'Shared paid event brand TEST',public.get_tv_tournament_branding_v1(original.tournament_id)->'layout',actor);
 -- Explicit local paired-display control-plane fixture, not pairing UI proof.
 INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
 VALUES(gen_random_uuid(),original.club_id,tv_token,original.tournament_id,'paired');
 INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
 VALUES(gen_random_uuid(),original.club_id,token_b,flight_b,'paired');
 expected_remaining:=CASE WHEN current_setting('test.paid_move')='true' THEN 4 ELSE 3 END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true);
 FOREACH branding IN ARRAY ARRAY[false,true] LOOP
  tv_payload:=public.get_tv_display_state_v4(tv_token,branding);
  IF tv_payload->>'status' IS DISTINCT FROM 'paired' OR tv_payload->'tournament'->>'id' IS DISTINCT FROM original.tournament_id::text
   OR tv_payload->'clock'->>'tournament_id' IS DISTINCT FROM original.tournament_id::text
   OR (tv_payload->'participation_counts'->>'remaining')::integer IS DISTINCT FROM expected_remaining
   OR (tv_payload->'participation_counts'->>'live_entry_stack')::bigint IS DISTINCT FROM expected_remaining*20000
   OR (tv_payload->'entries'->>'total_confirmed')::integer IS DISTINCT FROM expected_remaining
   OR (tv_payload->'tournament'->>'players_remaining')::integer IS DISTINCT FROM expected_remaining
   OR (tv_payload->'tournament'->>'average_stack')::bigint IS DISTINCT FROM 20000
   OR (tv_payload->'levels'->0->>'big_blind')::bigint IS DISTINCT FROM 200 THEN
   RAISE EXCEPTION 'anonymous_tv_not_matching_paid_floor_participation: %',tv_payload;END IF;
  payload_b:=public.get_tv_display_state_v4(token_b,branding);
  IF payload_b->>'status' IS DISTINCT FROM 'paired' OR payload_b->'tournament'->>'id' IS DISTINCT FROM flight_b::text
   OR payload_b->'clock'->>'tournament_id' IS DISTINCT FROM flight_b::text
   OR (payload_b->'participation_counts'->>'remaining')::integer IS DISTINCT FROM 1
   OR (payload_b->'participation_counts'->>'live_entry_stack')::bigint IS DISTINCT FROM 40000
   OR (payload_b->'entries'->>'total_confirmed')::integer IS DISTINCT FROM 1
   OR (payload_b->'tournament'->>'average_stack')::bigint IS DISTINCT FROM 40000
   OR (payload_b->'levels'->0->>'big_blind')::bigint IS DISTINCT FROM 1000
   OR payload_b->'clock'->>'remaining_seconds' IS NULL OR tv_payload->'clock'->>'remaining_seconds' IS NULL
   OR (payload_b->'clock'->>'remaining_seconds')::numeric <= (tv_payload->'clock'->>'remaining_seconds')::numeric+300 THEN
   RAISE EXCEPTION 'shared_event_paid_flights_runtime_leaked: %',payload_b;END IF;
  IF branding AND (payload_b->'display'->>'club_brand_name' IS DISTINCT FROM 'Shared paid event brand TEST'
   OR tv_payload->'display'->>'club_brand_name' IS DISTINCT FROM 'Shared paid event brand TEST') THEN
   RAISE EXCEPTION 'shared_event_brand_not_shared';END IF;
 END LOOP;
 PERFORM set_config('role','none',true);
 clock_revision_a:=tv_payload->'clock'->>'control_revision';
 IF clock_revision_a IS NULL THEN RAISE EXCEPTION 'clock_revision_missing_for_canonical_control';END IF;
 SELECT to_jsonb(t) INTO flight_b_before FROM public.tournaments t WHERE id=flight_b;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_control_tournament_clock(original.tournament_id,'pause',NULL,clock_revision_a);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'shared_event_flight_a_pause_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT to_jsonb(t) INTO paused_a_before FROM public.tournaments t WHERE id=original.tournament_id;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_control_tournament_clock(original.tournament_id,'resume',NULL,clock_revision_a);
 IF r->>'error' IS DISTINCT FROM 'stale_clock_state' THEN RAISE EXCEPTION 'old_clock_revision_not_rejected: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT to_jsonb(t) FROM public.tournaments t WHERE id=original.tournament_id) IS DISTINCT FROM paused_a_before
 OR (SELECT to_jsonb(t) FROM public.tournaments t WHERE id=flight_b) IS DISTINCT FROM flight_b_before THEN
  RAISE EXCEPTION 'pause_or_stale_retry_changed_wrong_flight';END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true);
 tv_payload:=public.get_tv_display_state_v4(tv_token,true);
 payload_b:=public.get_tv_display_state_v4(token_b,true);
 IF (tv_payload->'clock'->>'is_running')::boolean IS DISTINCT FROM false
 OR (payload_b->'clock'->>'is_running')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'shared_event_pause_leaked_to_other_flight';END IF;
 PERFORM set_config('role','none',true);
END $$;
ROLLBACK;
SELECT 'ACTUAL_HAND_PAID_WAIT_FINISH_PENDING_MODE_THEN_SEAT_PASS';
