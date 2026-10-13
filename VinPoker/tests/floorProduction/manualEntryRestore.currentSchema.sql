\set ON_ERROR_STOP on
\if :{?registered_entry}
\else
\set registered_entry false
\endif
-- Isolated retained-schema PG17 only. Prove the public create→bust→read seam.
DO $$ BEGIN
 IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
   OR current_database() NOT LIKE 'vinpoker_ops_floor66_%'
   OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
   RAISE EXCEPTION 'manual_restore_isolated_runtime_required'; END IF;
END $$;
BEGIN;
-- Transaction-local fault hooks, installed only after the isolated-PG guard.
CREATE FUNCTION public.manual_restore68_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('vinpoker.test_restore68_fault',true)=TG_TABLE_NAME THEN
   RAISE EXCEPTION 'restore68_injected_%',TG_TABLE_NAME; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manual_restore68_ticket_fault BEFORE INSERT ON public.seat_draw_receipts
 FOR EACH ROW EXECUTE FUNCTION public.manual_restore68_test_fault();
CREATE TRIGGER manual_restore68_audit_fault BEFORE INSERT ON public.seat_assignment_history
 FOR EACH ROW EXECUTE FUNCTION public.manual_restore68_test_fault();
CREATE TRIGGER manual_restore68_receipt_fault BEFORE INSERT ON public.table_operation_receipts
 FOR EACH ROW EXECUTE FUNCTION public.manual_restore68_test_fault();
INSERT INTO auth.users(id) VALUES('f7670000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7670000-0000-4000-8000-000000000002','f7670000-0000-4000-8000-000000000001','Manual restore TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,starting_stack) VALUES
 ('f7670000-0000-4000-8000-000000000003','f7670000-0000-4000-8000-000000000002','Manual restore TEST','active','registering',20000);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7670000-0000-4000-8000-000000000011','f7670000-0000-4000-8000-000000000002','Manual restore TEST',79,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7670000-0000-4000-8000-000000000001',true);
SELECT set_config('vinpoker.test_restore68_registered', :'registered_entry',true);
\if :registered_entry
INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,buy_in,reference_code,status)
 VALUES('f7670000-0000-4000-8000-000000000021','f7670000-0000-4000-8000-000000000003',
 'f7670000-0000-4000-8000-000000000001','f7670000-0000-4000-8000-000000000002',0,'RESTORE68-REGISTERED-TEST','confirmed');
INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,current_stack,status,source)
 VALUES('f7670000-0000-4000-8000-000000000031','f7670000-0000-4000-8000-000000000003',
 'f7670000-0000-4000-8000-000000000021','f7670000-0000-4000-8000-000000000001',1,20000,'registered','online');
\endif
DO $$
DECLARE opened jsonb; created jsonb; busted jsonb; restored jsonb; replayed jsonb; ticket jsonb; entry uuid; tt uuid; sess uuid; rev bigint; epoch bigint;
 restore_key uuid:=gen_random_uuid();
 proof record;
 fault_point text; fault_key uuid; snapshot_sql text; before_state jsonb; after_state jsonb;
BEGIN
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3('f7670000-0000-4000-8000-000000000003',
   'f7670000-0000-4000-8000-000000000011','manual',gen_random_uuid());
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'manual_restore_open_failed: %',opened; END IF;
 tt:=(opened->>'tournament_table_id')::uuid;sess:=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 IF current_setting('vinpoker.test_restore68_registered')='true' THEN
   created:=public.floor_assign_entry_to_seat('f7670000-0000-4000-8000-000000000031',tt,1,rev,gen_random_uuid());
   created:=created||jsonb_build_object('entry_id','f7670000-0000-4000-8000-000000000031');
   PERFORM set_config('role','none',true);
   UPDATE public.tournament_seats SET player_name='Manual restore person TEST' WHERE id=(created->>'seat_id')::uuid;
   PERFORM set_config('role','authenticated',true);
 ELSE
   created:=public.floor_add_manual_player_v1('f7670000-0000-4000-8000-000000000003','Manual restore person TEST',
     tt,1,sess,rev,epoch,gen_random_uuid(),'f7670000-0000-4000-8000-000000000001');
 END IF;
 IF created->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'manual_restore_create_failed: %',created; END IF;
 entry:=(created->>'entry_id')::uuid;rev:=(created->>'revision')::bigint;
 busted:=public.floor_bust_player_v3(entry,rev,epoch,20000,gen_random_uuid(),'manual_restore_TEST');
 IF busted->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'manual_restore_bust_failed: %',busted; END IF;
 PERFORM set_config('request.jwt.claim.sub','f7670000-0000-4000-8000-000000000099',true);
 BEGIN
   PERFORM 1 FROM public.get_floor_restorable_entries_v3('f7670000-0000-4000-8000-000000000003');
   RAISE EXCEPTION 'manual_restore_foreign_actor_read_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM set_config('request.jwt.claim.sub','f7670000-0000-4000-8000-000000000001',true);
 SELECT * INTO proof FROM public.get_floor_restorable_entries_v3('f7670000-0000-4000-8000-000000000003') WHERE entry_id=entry;
 IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_RESTORABLE_ENTRY_MISSING: canonical manual entry created and busted successfully'; END IF;
 IF proof.display_name IS DISTINCT FROM 'Manual restore person TEST' OR proof.current_stack IS DISTINCT FROM 20000 THEN
   RAISE EXCEPTION 'manual_restore_display_stack_mismatch: %',row_to_json(proof); END IF;
 PERFORM set_config('role','none',true);
 SELECT revision INTO rev FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 restored:=public.floor_restore_busted_player_to_seat_v5(entry,tt,1,rev,epoch,restore_key,sess);
 IF restored->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'manual_restore_writer_failed: %',restored; END IF;
 ticket:=public.get_current_floor_seat_ticket_v1('f7670000-0000-4000-8000-000000000003',entry,(restored->>'seat_id')::uuid);
 IF ticket->>'ok' IS DISTINCT FROM 'true' OR ticket->>'receipt_code' IS DISTINCT FROM restored->>'receipt_code'
   OR (ticket->>'stack_at_issue')::integer IS DISTINCT FROM 20000 THEN
   RAISE EXCEPTION 'manual_restore_current_ticket_unusable: %',ticket; END IF;
 replayed:=public.floor_restore_busted_player_to_seat_v5(entry,tt,1,rev,epoch,restore_key,sess);
 IF replayed IS DISTINCT FROM restored THEN RAISE EXCEPTION 'manual_restore_replay_changed'; END IF;
 replayed:=public.floor_restore_busted_player_to_seat_v5(entry,tt,2,rev,epoch,restore_key,sess);
 IF replayed->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'manual_restore_changed_payload_accepted'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_floor_restorable_entries_v3('f7670000-0000-4000-8000-000000000003') WHERE entry_id=entry) THEN
   RAISE EXCEPTION 'manual_restore_active_entry_still_offered'; END IF;
 PERFORM set_config('role','none',true);
 IF NOT EXISTS(SELECT 1 FROM public.tournament_entries e JOIN public.tournament_seats s ON s.id=e.seat_id AND s.entry_id=e.id
   WHERE e.id=entry AND s.id=(restored->>'seat_id')::uuid AND s.is_active AND e.seat_number=s.seat_number
     AND e.table_id='f7670000-0000-4000-8000-000000000011'::uuid AND s.table_id=tt
     AND s.tournament_table_id=tt AND s.table_session_id=sess) THEN
   RAISE EXCEPTION 'RESTORE_CANONICAL_ENTRY_SEAT_TUPLE_MISMATCH'; END IF;
 IF (SELECT count(*) FROM public.tournament_entries WHERE id=entry
     AND CASE WHEN current_setting('vinpoker.test_restore68_registered')='true' THEN
       registration_id='f7670000-0000-4000-8000-000000000021'::uuid ELSE registration_id IS NULL END
     AND current_stack=20000 AND status='seated')<>1
   OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id=entry AND is_active AND chip_count=20000)<>1
   OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id=entry AND is_active)<>1
   OR (SELECT count(*) FROM public.tournament_chip_counts c JOIN public.tournament_entries e
     ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no
     WHERE e.id=entry AND c.chip_count=20000)<>1 THEN
   RAISE EXCEPTION 'manual_restore_entry_stack_conservation_failed'; END IF;
 -- Bust the restored entry again; failed subsequent restores must preserve all
 -- existing seats, ticket cancellation, audit, receipts and chip projections.
 SELECT revision INTO rev FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 busted:=public.floor_bust_player_v3(entry,rev,epoch,20000,gen_random_uuid(),'restore68_fault_TEST');
 IF busted->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'restore68_fault_bust_failed'; END IF;
 PERFORM set_config('role','none',true);
 SELECT revision INTO rev FROM public.table_sessions WHERE id=sess;
 snapshot_sql:=format($snapshot$
 SELECT jsonb_build_object(
   'entry',(SELECT to_jsonb(e) FROM public.tournament_entries e WHERE e.id=%1$L::uuid),
   'session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE s.id=%2$L::uuid),
   'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s WHERE s.entry_id=%1$L::uuid),
   'tickets',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.seat_draw_receipts r WHERE r.entry_id=%1$L::uuid),
   'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.seat_assignment_history a WHERE a.entry_id=%1$L::uuid),
   'chips',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.player_id,c.entry_number) FROM public.tournament_chip_counts c
     JOIN public.tournament_entries e ON e.tournament_id=c.tournament_id AND e.player_id=c.player_id AND e.entry_no=c.entry_number WHERE e.id=%1$L::uuid),
   'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.request_id) FROM public.table_operation_receipts r
     WHERE r.actor_id='f7670000-0000-4000-8000-000000000001'::uuid))
 $snapshot$,entry,sess);
 EXECUTE snapshot_sql INTO before_state;
 FOREACH fault_point IN ARRAY ARRAY['seat_draw_receipts','seat_assignment_history','table_operation_receipts'] LOOP
   fault_key:=gen_random_uuid();
   PERFORM set_config('vinpoker.test_restore68_fault',fault_point,true);
   PERFORM set_config('role','authenticated',true);
   BEGIN
     restored:=public.floor_restore_busted_player_to_seat_v5(entry,tt,1,rev,epoch,fault_key,sess);
     RAISE EXCEPTION 'restore68_fault_unexpected_success';
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
     IF SQLERRM IS DISTINCT FROM 'restore68_injected_'||fault_point THEN RAISE; END IF;
   END;
   PERFORM set_config('role','none',true);
   PERFORM set_config('vinpoker.test_restore68_fault','',true);
   EXECUTE snapshot_sql INTO after_state;
   IF after_state IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'restore68_partial_commit_%',fault_point; END IF;
 END LOOP;
END $$;
ROLLBACK;
