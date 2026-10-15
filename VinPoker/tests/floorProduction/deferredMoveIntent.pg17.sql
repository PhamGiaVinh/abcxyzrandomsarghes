\set ON_ERROR_STOP on
\if :{?SCOPED_FINISH_MODE_CASE}
SELECT set_config('test.scoped_finish_mode','true',false);
\else
SELECT set_config('test.scoped_finish_mode','false',false);
\endif
\if :{?READ_POLICY_CASE}
\set TEST_READ_POLICY true
\else
\set TEST_READ_POLICY false
\endif
-- Current-schema TEST only. Public producers and actual terminal-hand trigger.
-- Direct void transition below tests the DB consumer, not the full finish RPC.
BEGIN;
\if :{?EXACT_QUEUE_CASE}
SELECT set_config('test.exact_queue','true',true);
\else
SELECT set_config('test.exact_queue','false',true);
\endif
SELECT set_config('test.read_policy', :'TEST_READ_POLICY', true);
DO $$ BEGIN
 IF current_database() NOT LIKE 'vinpoker_ops_%' OR inet_server_addr()<>'127.0.0.1'::inet THEN
  RAISE EXCEPTION 'isolated loopback DB required';
 END IF;
END $$;
\if :{?QUEUE_REASON_FAILURE_CASE}
SELECT set_config('test.queue_reason_failure','true',true);
CREATE FUNCTION pg_temp.fail_pending_reason() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tournament_id='f7290000-0000-4000-8000-000000000003'::uuid THEN
  RAISE EXCEPTION 'forced_pending_reason_failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_pending_reason_failure BEFORE UPDATE OF requested_reason ON public.floor_pending_tracker_moves
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_pending_reason();
\else
SELECT set_config('test.queue_reason_failure','false',true);
\endif
\if :{?TICKET_FAILURE_CASE}
SELECT set_config('test.ticket_failure','true',true);
CREATE FUNCTION pg_temp.fail_deferred_ticket_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tournament_id='f7290000-0000-4000-8000-000000000003'::uuid THEN
  RAISE EXCEPTION 'forced_ticket_audit_test';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_deferred_ticket_audit_failure BEFORE INSERT ON public.seat_assignment_history
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_deferred_ticket_audit();
\else
SELECT set_config('test.ticket_failure','false',true);
\endif
\if :{?SEAT_TICKET_CASE}
SELECT set_config('test.deferred_seat_ticket','true',true);
\else
SELECT set_config('test.deferred_seat_ticket','false',true);
\endif
\if :{?READ_TICKET_CASE}
SELECT set_config('test.ticket_read','true',true);
\else
SELECT set_config('test.ticket_read','false',true);
\endif
\if :{?MOVE_NAME_CASE}
SELECT set_config('test.move_name','true',true);
\endif
\if :{?TRACKER_BREAK_CASE}
SELECT set_config('test.tracker_break_case','true',true);
\else
SELECT set_config('test.tracker_break_case','false',true);
\endif
\if :{?REAL_FINISH_CASE}
SELECT set_config('test.real_finish_case','true',true);
\else
SELECT set_config('test.real_finish_case','false',true);
\endif
\if :{?CANCEL_CASE}
SELECT set_config('test.cancel_case','true',true);
\else
SELECT set_config('test.cancel_case','false',true);
\endif
\if :{?STALE_EPOCH_CASE}
SELECT set_config('test.stale_epoch_case','true',true);
\else
SELECT set_config('test.stale_epoch_case','false',true);
\endif
\if :{?BAD_RECEIPT_CASE}
SELECT set_config('test.bad_receipt_case','true',true);
\else
SELECT set_config('test.bad_receipt_case','false',true);
\endif
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'deferred_move_intent: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('f7290000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7290000-0000-4000-8000-000000000002','f7290000-0000-4000-8000-000000000001','Deferred intent TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7290000-0000-4000-8000-000000000003','f7290000-0000-4000-8000-000000000002','Deferred intent TEST','live','playing',1);
INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break) VALUES
 ('f7290000-0000-4000-8000-000000000003',1,100,100,0,false);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7290000-0000-4000-8000-000000000011','f7290000-0000-4000-8000-000000000002','Source TEST',81,'tournament','inactive','available'),
 ('f7290000-0000-4000-8000-000000000012','f7290000-0000-4000-8000-000000000002','Destination TEST',82,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7290000-0000-4000-8000-000000000001',true);
DO $$ DECLARE s jsonb; d jsonb; r jsonb; original jsonb; req uuid; se bigint; de bigint; st uuid; dt uuid; ss uuid; ds uuid; e uuid; h uuid; ep bigint; sr bigint; dr bigint; token text; ticket_code text; operator_actor uuid;
 finish_intent jsonb; finish_receipt jsonb; finish_epoch bigint; BEGIN
 IF current_setting('test.scoped_finish_mode')='true' THEN
  PERFORM pg_temp.assert_true(current_database() IN ('vinpoker_ops_history98_ci','vinpoker_ops_history98_rollback')
    AND current_setting('test.real_finish_case')='true' AND current_setting('test.exact_queue')='true',
    'scoped Finish mode case requires exact owned98/current APIs and public queue');
 END IF;
 IF current_setting('test.ticket_read')='true' THEN
  PERFORM pg_temp.assert_true(current_setting('test.deferred_seat_ticket')='true'
    AND current_setting('test.real_finish_case')='true','ticket reader proof requires seat tickets and real public finish');
 END IF;
 s:=public.floor_open_tournament_table_v3('f7290000-0000-4000-8000-000000000003','f7290000-0000-4000-8000-000000000011','manual',gen_random_uuid());
 d:=public.floor_open_tournament_table_v3('f7290000-0000-4000-8000-000000000003','f7290000-0000-4000-8000-000000000012','manual',gen_random_uuid());
 PERFORM pg_temp.assert_true((s->>'ok')::boolean AND (d->>'ok')::boolean,'both sessions open');
 st:=(s->>'tournament_table_id')::uuid; ss:=(s->>'table_session_id')::uuid;
 dt:=(d->>'tournament_table_id')::uuid; ds:=(d->>'table_session_id')::uuid;
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
 VALUES('f7290000-0000-4000-8000-000000000030','f7290000-0000-4000-8000-000000000002','TEST','08:00','23:00');
 INSERT INTO public.dealers(id,club_id,full_name,status)
 VALUES('f7290000-0000-4000-8000-000000000031','f7290000-0000-4000-8000-000000000002','Source dealer TEST','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
 VALUES('f7290000-0000-4000-8000-000000000041','f7290000-0000-4000-8000-000000000031','f7290000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"f7290000-0000-4000-8000-000000000001"}',true);
 INSERT INTO public.dealer_assignments(table_id,table_session_id,attendance_id,dealer_id,club_id,status,assigned_at)
 VALUES('f7290000-0000-4000-8000-000000000011',ss,'f7290000-0000-4000-8000-000000000041','f7290000-0000-4000-8000-000000000031','f7290000-0000-4000-8000-000000000002','assigned',now());
 IF current_setting('test.read_policy')='true' THEN
   UPDATE public.dealer_attendance SET current_state='assigned' WHERE id='f7290000-0000-4000-8000-000000000041';
 END IF;
 SELECT control_epoch INTO ep FROM public.table_sessions WHERE id=ss;
 r:=public.set_tracker_table_roster_seat_v2('f7290000-0000-4000-8000-000000000003',st,ss,ep,gen_random_uuid(),1,'Source TEST',20000);
 PERFORM pg_temp.assert_true((r->>'ok')::boolean,'source roster');
 SELECT entry_id INTO e FROM public.tournament_seats WHERE tournament_table_id=st AND is_active;
 IF current_setting('test.move_name',true)='true' THEN
  -- Leave an older nonblank image in exact-entry history, then clear the
  -- current seat through the authenticated roster API before queuing.
  token:=public.get_tracker_roster_snapshot_v1('f7290000-0000-4000-8000-000000000003',st,ss,ep)->'seats'->0->>'token';
  PERFORM set_config('role','authenticated',true);
  r:=public.set_tracker_table_roster_seat_v2('f7290000-0000-4000-8000-000000000003',st,ss,ep,gen_random_uuid(),1,'Source TEST',20000,
   (SELECT player_id FROM public.tournament_seats WHERE entry_id=e AND is_active),true,'https://example.test/storage/v1/object/public/tournament-photos/f7290000-0000-4000-8000-000000000003/seat-avatars/deferred.png',token);
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(r->>'ok'='true','public source avatar replacement commits: '||r::text);
  SELECT revision INTO sr FROM public.table_sessions WHERE id=ss;
  r:=public.move_player_seat_v2(e,st,4,sr,sr,gen_random_uuid());
  PERFORM pg_temp.assert_true(r->>'ok'='true','source moves leaving historical avatar evidence');
  token:=public.get_tracker_roster_snapshot_v1('f7290000-0000-4000-8000-000000000003',st,ss,ep)->'seats'->3->>'token';
  PERFORM set_config('role','authenticated',true);
  r:=public.set_tracker_table_roster_seat_v2('f7290000-0000-4000-8000-000000000003',st,ss,ep,gen_random_uuid(),4,'Source TEST',20000,
   (SELECT player_id FROM public.tournament_seats WHERE entry_id=e AND is_active),true,NULL,token);
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(r->>'ok'='true','public source avatar clear commits');
 END IF;
 FOR i IN 1..2 LOOP
  SELECT control_epoch INTO ep FROM public.table_sessions WHERE id=ds;
  r:=public.set_tracker_table_roster_seat_v2('f7290000-0000-4000-8000-000000000003',dt,ds,ep,gen_random_uuid(),i,'Destination TEST '||i,20000);
  PERFORM pg_temp.assert_true((r->>'ok')::boolean,'destination roster');
 END LOOP;
 UPDATE public.table_sessions SET control_mode='tracker' WHERE id=ds RETURNING control_epoch INTO ep;
 r:=public.start_tracker_hand_v3('f7290000-0000-4000-8000-000000000003',dt,ds,ep,1,now(),'f7290000-0000-4000-8000-000000000001',1);
 PERFORM pg_temp.assert_true(r->>'status'='success','destination hand starts'); h:=(r->>'hand_id')::uuid;
 -- DEFERRED_CONCURRENCY_FIXTURE_READY
 SELECT revision INTO sr FROM public.table_sessions WHERE id=ss;
 SELECT revision INTO dr FROM public.table_sessions WHERE id=ds;
 IF current_setting('test.tracker_break_case')='true' THEN
  UPDATE public.table_sessions SET control_mode='tracker' WHERE id=ss;
  SELECT revision INTO sr FROM public.table_sessions WHERE id=ss;
  s:=public.floor_plan_break_table_v1(st,sr,'fill_lowest_table');
  PERFORM pg_temp.assert_true((s->>'ok')::boolean AND (s->>'complete')::boolean,'idle Tracker break plan is complete');
  r:=public.floor_break_table_v5(st,sr,gen_random_uuid(),'fill_lowest_table',s->>'plan_hash');
  PERFORM pg_temp.assert_true((r->>'ok')::boolean AND (r->>'break_pending')::boolean,'Tracker break queues');
  IF current_setting('test.deferred_seat_ticket')='true' THEN
   PERFORM pg_temp.assert_true(r->'issued_tickets'='[]'::jsonb,'queued break has no issued destination ticket yet');
  END IF;
  -- Attempt a legacy/direct writer, exercising the common DB trust boundary.
  BEGIN
   INSERT INTO public.tournament_hands
   SELECT (jsonb_populate_record(NULL::public.tournament_hands,
     to_jsonb(hh)||jsonb_build_object('id',gen_random_uuid(),'table_id',st,
       'tournament_table_id',st,'table_session_id',ss))).*
   FROM public.tournament_hands hh WHERE hh.id=h;
   RAISE EXCEPTION 'source hand unexpectedly started';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM<>'source_break_pending' THEN RAISE; END IF;
  END;
 ELSE
  IF current_setting('test.exact_queue')='true' THEN
   req:=gen_random_uuid();
   SELECT control_epoch INTO se FROM public.table_sessions WHERE id=ss;
   SELECT control_epoch INTO de FROM public.table_sessions WHERE id=ds;
   r:=public.move_player_seat_v5(e,st,ss,dt,ds,3,sr,dr,se,de+1,'TEST exact reason',req);
   PERFORM pg_temp.assert_true(r->>'error'='STALE_CONTROL_EPOCH','wrong epoch denies before queue');
   PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves WHERE entry_id=e),'denial creates no pending move');
   IF current_setting('test.queue_reason_failure')='true' THEN
    BEGIN
     r:=public.move_player_seat_v5(e,st,ss,dt,ds,3,sr,dr,se,de,'TEST exact reason',req);
     RAISE EXCEPTION 'reason failure unexpectedly committed';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
     IF SQLERRM<>'forced_pending_reason_failure' THEN RAISE; END IF;
    END;
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves WHERE entry_id=e),
      'failed reason update rolls back pending row');
    PERFORM pg_temp.assert_true((SELECT revision=dr FROM public.table_sessions WHERE id=ds),'failed reason update rolls back revision');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(
      'f7290000-0000-4000-8000-000000000001','move_player_seat_v5',req)),'failed reason update leaves no outer success receipt');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(
      'f7290000-0000-4000-8000-000000000001','floor_queue_tracker_move_v1',req)),'failed reason update leaves no child success receipt');
    RETURN;
   END IF;
   IF current_setting('test.scoped_finish_mode')='true' THEN
    PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"f7290000-0000-4000-8000-000000000001"}',true);
    PERFORM set_config('role','authenticated',true);
   END IF;
   r:=public.move_player_seat_v5(e,st,ss,dt,ds,3,sr,dr,se,de,'TEST exact reason',req);
   IF current_setting('test.scoped_finish_mode')='true' THEN PERFORM set_config('role','none',true); END IF;
   PERFORM pg_temp.assert_true(r->>'queued'='true' AND r->>'reason'='TEST exact reason'
     AND r->>'from_table_session_id'=ss::text AND r->>'to_table_session_id'=ds::text
     AND r->>'request_id'=req::text AND NOT(r ? 'receipt_code'),'queued receipt proves exact intent without a ticket: '||r::text);
   original:=r;
   r:=public.move_player_seat_v5(e,st,ss,dt,ds,3,sr,dr,se,de,'TEST exact reason',req);
   PERFORM pg_temp.assert_true(r=original,'lost response replay returns identical queued receipt despite revision bump');
   r:=public.move_player_seat_v5(e,st,ss,dt,ds,3,sr,dr,se,de,'Different reason',req);
   PERFORM pg_temp.assert_true(r->>'error'='IDEMPOTENCY_CONFLICT','changed reason conflicts');
   PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.floor_pending_tracker_moves WHERE entry_id=e),'one pending effect');
   r:=original;
  ELSE
   r:=public.floor_queue_tracker_move_v1(e,dt,3,sr,dr,gen_random_uuid());
  END IF;
  PERFORM pg_temp.assert_true((r->>'ok')::boolean,'ordinary last-player move queues');
 END IF;
 IF current_setting('test.ticket_read')='true' THEN
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.seat_draw_receipts WHERE entry_id=e),
    'queued deferred move cannot be printed before application');
  PERFORM set_config('role','authenticated',true);
  r:=public.get_floor_seat_ticket_v1('f7290000-0000-4000-8000-000000000003',e,'NOT-ISSUED');
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(r->>'error'='ticket_not_found','unissued deferred ticket is denied');
 END IF;
 IF current_setting('test.cancel_case')='true' THEN
  SELECT id INTO e FROM public.floor_pending_tracker_moves WHERE entry_id=e;
  r:=public.floor_cancel_pending_tracker_move_v1(e);
  PERFORM pg_temp.assert_true((r->>'ok')::boolean,'queued move cancels through public RPC');
 ELSIF current_setting('test.stale_epoch_case')='true' THEN
  UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id=ss;
 ELSIF current_setting('test.bad_receipt_case')='true' THEN
  UPDATE public.table_operation_receipts SET result=jsonb_set(result,'{table_session_id}',to_jsonb(gen_random_uuid()::text))
  WHERE actor_id='f7290000-0000-4000-8000-000000000001' AND operation_type='floor_break_table_v5';
 END IF;
 IF current_setting('test.real_finish_case')='true' THEN
  token:=public.get_tracker_roster_snapshot_v1('f7290000-0000-4000-8000-000000000003',dt,ds,ep)->'seats'->0->>'token';
  IF current_setting('test.scoped_finish_mode')='true' THEN
   PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"f7290000-0000-4000-8000-000000000001"}',true);
   SELECT revision,control_epoch INTO dr,finish_epoch FROM public.table_sessions WHERE id=ds;
   PERFORM set_config('role','authenticated',true);
   r:=public.floor_request_table_control_mode_v4(dt,ds,'manual',dr,finish_epoch,gen_random_uuid());
   PERFORM set_config('role','none',true);
   PERFORM pg_temp.assert_true(r->>'outcome'='pending' AND r->'blockers' ? 'active_hand' AND r->'blockers' ? 'pending_move',
     'mode waits for active hand and exact pending move: '||r::text);
   SELECT jsonb_build_object('actor_id','f7290000-0000-4000-8000-000000000001','request_id',gen_random_uuid(),
    'tournament_id',hh.tournament_id,'tournament_table_id',dt,'hand_id',h,'table_session_id',ds,
    'control_epoch',finish_epoch,'source_revision',hh.source_revision,
    'payload',jsonb_build_object('hand_time',now(),'players',(SELECT jsonb_agg(jsonb_build_object(
     'player_id',hp.player_id,'entry_number',hp.entry_number,'seat_number',hp.seat_number,'starting_stack',hp.starting_stack,
     'ending_stack',hp.starting_stack+CASE hp.seat_number WHEN 1 THEN 100 WHEN 2 THEN -100 ELSE 0 END,
     'is_eliminated',false)) FROM public.hand_players hp WHERE hp.hand_id=h),
     'actions','[]'::jsonb,'side_pots','[]'::jsonb,'community_cards','[]'::jsonb,'pot_size',0)) INTO finish_intent
   FROM public.tournament_hands hh WHERE hh.id=h;
   PERFORM set_config('role','authenticated',true);
   r:=public.record_tracker_manual_hand_v1(finish_intent);
   PERFORM set_config('role','none',true);
   finish_receipt:=r;
  ELSE
  r:=public.record_hand('f7290000-0000-4000-8000-000000000003',dt,1,now(),
    (SELECT jsonb_agg(jsonb_build_object('player_id',hp.player_id,
      'entry_number',hp.entry_number,'seat_number',hp.seat_number,
      'starting_stack',hp.starting_stack,'ending_stack',hp.starting_stack+CASE hp.seat_number WHEN 1 THEN 100 WHEN 2 THEN -100 ELSE 0 END,
      'is_eliminated',false)) FROM public.hand_players hp WHERE hp.hand_id=h),
    '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0,'f7290000-0000-4000-8000-000000000001');
  END IF;
  PERFORM pg_temp.assert_true((r->>'ok')::boolean,'public record_hand finishes: '||r::text);
  r:=public.set_tracker_table_roster_seat_v2('f7290000-0000-4000-8000-000000000003',dt,ds,ep,gen_random_uuid(),1,'Destination TEST 1',20000,
   (SELECT player_id FROM public.tournament_seats WHERE table_session_id=ds AND seat_number=1 AND is_active),false,NULL,token);
  PERFORM pg_temp.assert_true(r->>'error'='STALE_ROSTER_STATE' OR (current_setting('test.scoped_finish_mode')='true' AND r->>'error'='STALE_STATE'),'pre-hand roster token cannot overwrite completed-hand stack');
  PERFORM pg_temp.assert_true((SELECT chip_count=20100 FROM public.tournament_seats WHERE table_session_id=ds AND seat_number=1 AND is_active),'hand ending stack survives delayed roster');
 ELSE
  UPDATE public.tournament_hands SET status='voided' WHERE id=h;
 END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 IF current_setting('test.scoped_finish_mode')='true' THEN
  PERFORM pg_temp.assert_true((SELECT control_mode='manual' AND control_epoch=finish_epoch+1 FROM public.table_sessions WHERE id=ds),
   'server applies queued mode only after safe move boundary');
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.assert_true(public.get_tracker_manual_finish_receipt_v1(finish_intent)=finish_receipt
    AND public.record_tracker_manual_hand_v1(finish_intent)=finish_receipt,'past Finish receipt survives move and mode');
  PERFORM set_config('role','none',true);
 END IF;
 IF current_setting('test.cancel_case')='true' THEN
  PERFORM pg_temp.assert_true((SELECT status='cancelled' FROM public.floor_pending_tracker_moves WHERE id=e),'cancel remains terminal');
  PERFORM pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id=ss),'cancel does not close source');
 ELSIF current_setting('test.stale_epoch_case')='true' OR current_setting('test.bad_receipt_case')='true' THEN
  PERFORM pg_temp.assert_true((SELECT status='stale' AND resolution_reason='control_mode_changed' FROM public.floor_pending_tracker_moves WHERE entry_id=e),'stale epoch rejects move');
  PERFORM pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id=ss),'stale epoch does not close source');
 ELSIF current_setting('test.ticket_failure')='true' THEN
  PERFORM pg_temp.assert_true((SELECT status='stale' AND resolution_reason='apply_sqlstate_P0001'
    FROM public.floor_pending_tracker_moves WHERE entry_id=e),'ticket failure rolls back apply and records stale');
  PERFORM pg_temp.assert_true((SELECT table_session_id=ss AND chip_count=20000
    FROM public.tournament_seats WHERE entry_id=e AND is_active),'ticket failure retains original occupied source and stack');
  PERFORM pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id=ss),'ticket failure does not close source');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.seat_draw_receipts WHERE entry_id=e),'ticket failure rolls back newly inserted ticket');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.seat_assignment_history WHERE entry_id=e),'ticket failure has no partially committed move audit');
 ELSE
 RAISE NOTICE 'queue result: %', (SELECT jsonb_build_object('status',status,'reason',resolution_reason) FROM public.floor_pending_tracker_moves WHERE entry_id=e);
 PERFORM pg_temp.assert_true((SELECT status='applied' FROM public.floor_pending_tracker_moves WHERE entry_id=e),'queued move applies');
 IF current_setting('test.exact_queue')='true' THEN
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.seat_assignment_history WHERE entry_id=e AND reason='TEST exact reason'),
    'user reason survives deferred application');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.seat_draw_receipts WHERE entry_id=e AND qr_payload->>'reason'='TEST exact reason'),
    'issued ticket retains user reason');
 END IF;
 IF current_setting('test.deferred_seat_ticket')='true' THEN
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.seat_draw_receipts receipt
   JOIN public.tournament_entries entry ON entry.id=receipt.entry_id
   WHERE entry.id=e AND receipt.seat_id=entry.seat_id AND receipt.seat_number=entry.seat_number
     AND receipt.status IN ('issued','printed') AND receipt.receipt_code IS NOT NULL),
   'applied deferred move must have exactly one server-issued destination ticket');
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.seat_assignment_history history
   JOIN public.floor_pending_tracker_moves move ON move.entry_id=history.entry_id
   WHERE history.entry_id=e AND history.metadata->>'pending_move_id'=move.id::text),
   'deferred move has exactly one matching audited move');
  UPDATE public.tournament_hands SET status=status WHERE id=h;
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.seat_draw_receipts receipt
   JOIN public.tournament_entries entry ON entry.id=receipt.entry_id
   WHERE entry.id=e AND receipt.seat_id=entry.seat_id AND receipt.status IN ('issued','printed')),
   'terminal-hand replay does not issue another ticket');
  IF current_setting('test.ticket_read')='true' THEN
   SELECT receipt_code INTO ticket_code FROM public.seat_draw_receipts WHERE entry_id=e AND status IN ('issued','printed') AND cancelled_at IS NULL;
   PERFORM set_config('role','authenticated',true);
   r:=public.get_floor_seat_ticket_v1('f7290000-0000-4000-8000-000000000003',e,ticket_code);
   PERFORM set_config('role','none',true);
   PERFORM pg_temp.assert_true(r->>'ok'='true' AND r->>'receipt_code'=ticket_code
     AND r->>'table_session_id'=ds::text AND r->>'tournament_table_id'=dt::text
     AND (r->>'stack_at_issue')::bigint=20000,'deferred ticket reader proves exact destination and immutable moved stack: '||r::text);
   RAISE NOTICE 'DEFERRED_CURRENT_TICKET_READER_AFTER_PUBLIC_FINISH_PASS';
   PERFORM set_config('role','authenticated',true);
   PERFORM pg_temp.assert_true(public.get_current_floor_seat_ticket_v1(
     'f7290000-0000-4000-8000-000000000003',e,(SELECT seat_id FROM public.tournament_entries WHERE id=e))=r,
     'current finder delegates identical audited proof');
   PERFORM pg_temp.assert_true(public.get_current_floor_seat_ticket_v1(
     'f7290000-0000-4000-8000-000000000003',e,'f7290000-0000-4000-8000-000000000099')->>'error'='ticket_not_current',
     'current finder rejects wrong exact seat');
   PERFORM set_config('role','none',true);
   INSERT INTO auth.users(id) VALUES('f7290000-0000-4000-8000-000000000091');
   INSERT INTO public.clubs(id,owner_id,name,region) VALUES
     ('f7290000-0000-4000-8000-000000000092','f7290000-0000-4000-8000-000000000091','Other club finder TEST','TEST');
   PERFORM set_config('request.jwt.claim.sub','f7290000-0000-4000-8000-000000000091',true);
   PERFORM set_config('role','authenticated',true);
   PERFORM pg_temp.assert_true(public.get_current_floor_seat_ticket_v1(
     'f7290000-0000-4000-8000-000000000003',e,(SELECT seat_id FROM public.tournament_entries WHERE id=e))->>'error'='actor_not_allowed',
     'valid other-club owner cannot discover current ticket');
   IF current_setting('test.read_policy')='true' THEN
     PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.seat_draw_receipts
       WHERE tournament_id='f7290000-0000-4000-8000-000000000003' AND entry_id=e),
       'valid other-club owner cannot SELECT private ticket rows directly');
   END IF;
   PERFORM set_config('role','none',true);
   PERFORM set_config('request.jwt.claim.sub','f7290000-0000-4000-8000-000000000001',true);
   IF current_setting('test.read_policy')='true' THEN
     INSERT INTO auth.users(id) VALUES
       ('f7290000-0000-4000-8000-000000000093'),('f7290000-0000-4000-8000-000000000094'),('f7290000-0000-4000-8000-000000000095');
     INSERT INTO public.club_cashiers(club_id,user_id) VALUES
       ('f7290000-0000-4000-8000-000000000002','f7290000-0000-4000-8000-000000000093');
     INSERT INTO public.club_floors(club_id,user_id) VALUES
       ('f7290000-0000-4000-8000-000000000002','f7290000-0000-4000-8000-000000000094');
     INSERT INTO public.user_roles(user_id,role) VALUES('f7290000-0000-4000-8000-000000000095','super_admin');
     FOREACH operator_actor IN ARRAY ARRAY['f7290000-0000-4000-8000-000000000001'::uuid,
       'f7290000-0000-4000-8000-000000000093'::uuid,'f7290000-0000-4000-8000-000000000094'::uuid,'f7290000-0000-4000-8000-000000000095'::uuid] LOOP
       PERFORM set_config('request.jwt.claim.sub',operator_actor::text,true);
       PERFORM set_config('role','authenticated',true);
       PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.seat_draw_receipts
         WHERE tournament_id='f7290000-0000-4000-8000-000000000003' AND entry_id=e),
         'same-club owner/cashier/floor and superadmin retain ticket SELECT');
       -- Match the two direct Cashier consumer projections, not only a count.
       PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.seat_draw_receipts
         WHERE tournament_id='f7290000-0000-4000-8000-000000000003' AND entry_id=e
           AND status IN ('issued','printed') AND receipt_code=ticket_code
           AND table_number IS NOT NULL AND seat_number IS NOT NULL AND issued_at IS NOT NULL),
         'RegistrationQueuePanel current-ticket projection remains visible');
       PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.seat_draw_receipts
         WHERE entry_id=e AND display_name IS NOT NULL AND issued_at IS NOT NULL),
         'ReentryPanel entry receipt display projection remains visible');
       IF operator_actor IN ('f7290000-0000-4000-8000-000000000094'::uuid,
         'f7290000-0000-4000-8000-000000000095'::uuid) THEN
         -- SELECT authorization must not expand the existing write policy.
         UPDATE public.seat_draw_receipts SET status='cancelled'
           WHERE entry_id=e AND receipt_code=ticket_code;
         PERFORM pg_temp.assert_true(NOT FOUND,'read-only operator cannot cancel ticket directly');
       END IF;
       PERFORM set_config('role','none',true);
     END LOOP;
     PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','public.get_floor_seat_ticket_v1(uuid,uuid,text)','EXECUTE')
       AND NOT has_function_privilege('anon','public.get_current_floor_seat_ticket_v1(uuid,uuid,uuid)','EXECUTE')
       AND NOT has_function_privilege('anon','public.can_read_floor_seat_tickets_v1(uuid)','EXECUTE'),
       'anonymous has no ticket reader/helper execute privilege');
     PERFORM set_config('request.jwt.claim.sub','',true);
     PERFORM set_config('role','anon',true);
     BEGIN
       PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.seat_draw_receipts
         WHERE entry_id=e),'anonymous must not see ticket rows');
     EXCEPTION WHEN insufficient_privilege THEN
       NULL; -- Table or predicate execute denial is also a zero-disclosure result.
     END;
     PERFORM set_config('role','none',true);
     PERFORM set_config('request.jwt.claim.sub','f7290000-0000-4000-8000-000000000001',true);
     RAISE NOTICE 'TICKET_SELECT_TENANT_AND_OPERATOR_ROLES_PASS';
   END IF;
   RAISE NOTICE 'CURRENT_TICKET_FINDER_EXACT_SEAT_AND_FOREIGN_CLUB_PASS';
  END IF;
 END IF;
 IF current_setting('test.move_name',true)='true' THEN
 PERFORM pg_temp.assert_true((SELECT table_id=dt AND tournament_table_id=dt AND table_session_id=ds
  FROM public.tournament_seats WHERE entry_id=e AND is_active),
  'deferred move retains exact destination participation tuple');
 PERFORM pg_temp.assert_true((SELECT player_name='Source TEST' AND chip_count=20000 AND avatar_url IS NULL
  FROM public.tournament_seats WHERE entry_id=e AND is_active),
  'deferred move preserves exact-entry name and avatar clear at the real hand boundary');
 END IF;
 IF current_setting('test.tracker_break_case')='true' THEN
  PERFORM pg_temp.assert_true((SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id=ss),'explicit Tracker break closes its source after move');
 ELSE
 PERFORM pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id=ss),'ordinary last-player move must not close its source');
 PERFORM pg_temp.assert_true((SELECT status='active' FROM public.tournament_tables WHERE id=st),'ordinary source logical table remains active');
 END IF;
 END IF;
 IF current_setting('test.cancel_case')='true' OR current_setting('test.stale_epoch_case')='true'
    OR current_setting('test.bad_receipt_case')='true' THEN
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.seat_draw_receipts receipt
   JOIN public.floor_pending_tracker_moves move ON move.entry_id=receipt.entry_id
   WHERE move.tournament_id='f7290000-0000-4000-8000-000000000003'),
   'cancelled/stale reservation must not issue any destination ticket');
 END IF;
 PERFORM pg_temp.assert_true((SELECT (released_at IS NOT NULL)=
   (current_setting('test.tracker_break_case')='true' AND current_setting('test.cancel_case')='false' AND current_setting('test.stale_epoch_case')='false' AND current_setting('test.bad_receipt_case')='false' AND current_setting('test.ticket_failure')='false')
   FROM public.dealer_assignments WHERE table_session_id=ss),'dealer released only by completed explicit break');
 IF current_setting('test.read_policy')='true' THEN
   PERFORM pg_temp.assert_true((SELECT current_state='available' FROM public.dealer_attendance
     WHERE id='f7290000-0000-4000-8000-000000000041'),'real deferred break closure frees its exact dealer attendance');
 END IF;
 PERFORM pg_temp.assert_true((SELECT sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='f7290000-0000-4000-8000-000000000003' AND is_active),'moves preserve all active chips');
 IF current_setting('test.ticket_read')='true' AND current_setting('test.cancel_case')='false'
   AND current_setting('test.stale_epoch_case')='false' AND current_setting('test.bad_receipt_case')='false'
   AND current_setting('test.ticket_failure')='false' AND current_setting('test.tracker_break_case')='true' THEN
  -- Reuse the actual physical source through public open, then move all players
  -- back through canonical break. The earlier deferred ticket is history, not
  -- current seating; reopening its old destination cannot revive it.
  PERFORM set_config('role','authenticated',true);
  s:=public.floor_open_tournament_table_v3('f7290000-0000-4000-8000-000000000003','f7290000-0000-4000-8000-000000000011','manual',gen_random_uuid());
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(s->>'ok'='true' AND s->>'table_session_id'<>ss::text
    AND s->>'tournament_table_id'<>st::text,'public source reopen creates a new logical/session incarnation: '||s::text);
  SELECT revision INTO dr FROM public.table_sessions WHERE id=ds;
  PERFORM set_config('role','authenticated',true);
  d:=public.floor_plan_break_table_v1(dt,dr,'fill_lowest_table');
  PERFORM pg_temp.assert_true(d->>'ok'='true' AND d->>'complete'='true','destination close has a complete real plan: '||d::text);
  r:=public.floor_break_table_v5(dt,dr,gen_random_uuid(),'fill_lowest_table',d->>'plan_hash');
  PERFORM pg_temp.assert_true(r->>'ok'='true' AND r->>'closed'='true','public break closes original destination: '||r::text);
  r:=public.get_floor_seat_ticket_v1('f7290000-0000-4000-8000-000000000003',e,ticket_code);
  PERFORM pg_temp.assert_true(r->>'error'='ticket_not_current','old deferred ticket cannot direct player after subsequent public move');
  d:=public.floor_open_tournament_table_v3('f7290000-0000-4000-8000-000000000003','f7290000-0000-4000-8000-000000000012','manual',gen_random_uuid());
  PERFORM pg_temp.assert_true(d->>'ok'='true' AND d->>'table_session_id'<>ds::text,'public destination reopen creates a new session');
  r:=public.get_floor_seat_ticket_v1('f7290000-0000-4000-8000-000000000003',e,ticket_code);
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(r->>'error'='ticket_not_current','reopened physical destination does not revive an obsolete ticket');
  PERFORM pg_temp.assert_true((SELECT chip_count=20000 AND table_session_id=(s->>'table_session_id')::uuid
    FROM public.tournament_seats WHERE entry_id=e AND is_active),'same entry stack moves into the exact newly opened source');
  PERFORM pg_temp.assert_true((SELECT sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='f7290000-0000-4000-8000-000000000003' AND is_active),'close/reopen does not create or lose chips');
  RAISE NOTICE 'DEFERRED_TICKET_PUBLIC_MOVE_CLOSE_REOPEN_DENIAL_PASS';
 END IF;
END $$;
ROLLBACK;
\if :{?SCOPED_FINISH_MODE_CASE}
\echo MANUAL_FINISH95_DEFERRED_MOVE_MODE_RECEIPT_TICKET_PASS
\endif
