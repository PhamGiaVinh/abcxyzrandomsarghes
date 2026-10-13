\set ON_ERROR_STOP on
\if :{?legacy_repro}
\else
\set legacy_repro false
\endif
-- Owned isolated current-schema database only. Never run this fixture live.
DO $$ BEGIN
 IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
   OR current_database() NOT LIKE 'vinpoker_ops_floor66_%'
   OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
   RAISE EXCEPTION 'manual66_isolated_runtime_required';
 END IF;
END $$;
BEGIN;
CREATE FUNCTION pg_temp.manual66_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('test.manual66_audit_fault',true)='on' THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='manual66_audit_fault';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manual66_audit_fault BEFORE INSERT ON public.seat_assignment_history
 FOR EACH ROW EXECUTE FUNCTION pg_temp.manual66_fail_audit();
CREATE FUNCTION pg_temp.manual66_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('test.manual66_receipt_fault',true)='on'
   AND NEW.operation_type='floor_add_manual_player_v1' THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='manual66_outer_receipt_fault';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manual66_outer_receipt_fault BEFORE INSERT ON public.table_operation_receipts
 FOR EACH ROW EXECUTE FUNCTION pg_temp.manual66_fail_receipt();
INSERT INTO auth.users(id) VALUES('f7660000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7660000-0000-4000-8000-000000000002','f7660000-0000-4000-8000-000000000001','Manual seat TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,starting_stack) VALUES
 ('f7660000-0000-4000-8000-000000000003','f7660000-0000-4000-8000-000000000002','Manual seat TEST','active','registering',20000);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7660000-0000-4000-8000-000000000011','f7660000-0000-4000-8000-000000000002','Manual seat TEST',76,'tournament','inactive','available'),
 ('f7660000-0000-4000-8000-000000000012','f7660000-0000-4000-8000-000000000002','Manual destination TEST',78,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7660000-0000-4000-8000-000000000001',true);
SELECT set_config('test.manual_seat_legacy_repro',:'legacy_repro',true);
DO $$
DECLARE opened jsonb; result jsonb; tt uuid; sess uuid; rev bigint; epoch bigint;
 original jsonb; proof jsonb; key uuid:=gen_random_uuid(); entry_count bigint; hand uuid;
 receipt_count bigint; fault_key uuid; dest_tt uuid; dest_sess uuid; move_uuid uuid;
BEGIN
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3('f7660000-0000-4000-8000-000000000003',
   'f7660000-0000-4000-8000-000000000011','manual',gen_random_uuid());
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture_open_failed: %',opened; END IF;
 tt:=(opened->>'tournament_table_id')::uuid; sess:=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','none',true);
 -- An older supported table has this physical alias. New V3 tables do not.
 -- Counterexample fixture only: never adopt/repair a production legacy alias.
 UPDATE public.tournament_tables SET table_id=game_table_id WHERE id=tt;
 SELECT revision INTO rev FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_set_table_seat_lock_v1(tt,1,true,'Manual seat lock TEST',rev,gen_random_uuid());
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture_lock_failed: %',result; END IF;
 IF current_setting('test.manual_seat_legacy_repro')='true' THEN
   result:=public.floor_assign_player_to_seat('f7660000-0000-4000-8000-000000000003','Locked walk-in TEST',tt,1);
   IF result->>'error' IS DISTINCT FROM 'seat_locked' THEN
     RAISE EXCEPTION 'LEGACY_LOCKED_WALKIN_REPRO: locked seat accepted or wrong denial: %',result;
   END IF;
   RETURN;
 END IF;
 result:=public.floor_assign_player_to_seat('f7660000-0000-4000-8000-000000000003','Old writer TEST',tt,1);
 IF result->>'error' IS DISTINCT FROM 'EXACT_SESSION_REQUIRED' THEN RAISE EXCEPTION 'legacy_writer_not_retired: %',result; END IF;
 PERFORM set_config('role','none',true);
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 original:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Walk-in TEST',tt,1,sess,rev,epoch,key,
   'f7660000-0000-4000-8000-000000000001');
 IF original->>'error' IS DISTINCT FROM 'seat_locked' THEN RAISE EXCEPTION 'new_locked_seat_not_denied: %',original; END IF;
 proof:=public.get_floor_manual_player_receipt_v1('f7660000-0000-4000-8000-000000000003',key,'f7660000-0000-4000-8000-000000000001');
 IF proof->>'status' IS DISTINCT FROM 'resolved' OR proof->'result' IS DISTINCT FROM original THEN
   RAISE EXCEPTION 'rejection_receipt_not_recoverable: %',proof; END IF;
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Different TEST',tt,1,sess,rev,epoch,key,
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'changed_name_must_conflict'; END IF;
 result:=public.floor_set_table_seat_lock_v1(tt,1,false,'Manual unlock TEST',rev,gen_random_uuid());
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture_unlock_failed'; END IF;
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Walk-in TEST',tt,1,sess,rev,epoch,key,
   'f7660000-0000-4000-8000-000000000001');
 IF result IS DISTINCT FROM original THEN RAISE EXCEPTION 'rejection_tombstone_must_not_become_success'; END IF;
 PERFORM set_config('role','none',true);
 UPDATE public.tournament_tables SET table_id=NULL WHERE id=tt;
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 key:=gen_random_uuid();
 original:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Canonical walk-in TEST',tt,1,sess,rev,epoch,key,
   'f7660000-0000-4000-8000-000000000001');
 IF original->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'new_canonical_walkin_failed: %',original; END IF;
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Canonical walk-in TEST',tt,1,sess,rev,epoch,key,
   'f7660000-0000-4000-8000-000000000001');
 IF result IS DISTINCT FROM original THEN RAISE EXCEPTION 'same_key_payload_not_replayed'; END IF;
 proof:=public.get_floor_manual_player_receipt_v1('f7660000-0000-4000-8000-000000000003',key,'f7660000-0000-4000-8000-000000000001');
 IF proof->'result' IS DISTINCT FROM original THEN RAISE EXCEPTION 'committed_receipt_missing'; END IF;
 PERFORM set_config('role','none',true);
 IF NOT EXISTS(SELECT 1 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
   JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no
   WHERE s.id=(original->>'seat_id')::uuid AND s.tournament_table_id=tt AND s.table_session_id=sess AND s.table_id=tt
     AND s.player_name='Canonical walk-in TEST' AND s.chip_count=20000 AND e.current_stack=20000 AND c.chip_count=20000
     AND e.source='manual' AND e.registration_id IS NULL AND e.status='seated'
     AND e.seat_id=s.id AND e.table_id='f7660000-0000-4000-8000-000000000011') THEN
   RAISE EXCEPTION 'manual_entry_seat_projection_tuple_mismatch'; END IF;
 IF (SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id=(original->>'entry_id')::uuid)<>1
   OR (SELECT count(*) FROM public.seat_assignment_history WHERE entry_id=(original->>'entry_id')::uuid)<>1 THEN
   RAISE EXCEPTION 'duplicate_or_missing_seat_ticket_history'; END IF;
 SELECT count(*) INTO entry_count FROM public.tournament_entries WHERE tournament_id='f7660000-0000-4000-8000-000000000003';
 SELECT revision INTO rev FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Occupied TEST',tt,1,sess,rev,epoch,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'seat_occupied' THEN RAISE EXCEPTION 'occupied_seat_not_denied: %',result; END IF;
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Stale TEST',tt,2,sess,rev-1,epoch,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'STALE_STATE' THEN RAISE EXCEPTION 'stale_revision_not_denied'; END IF;
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Epoch TEST',tt,2,sess,rev,epoch+1,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'STALE_STATE' THEN RAISE EXCEPTION 'stale_epoch_not_denied'; END IF;
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Capacity TEST',tt,10,sess,rev,epoch,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'invalid_seat_number' THEN RAISE EXCEPTION 'capacity_not_denied'; END IF;
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Actor TEST',tt,2,sess,rev,epoch,gen_random_uuid(),gen_random_uuid());
 IF result->>'error' IS DISTINCT FROM 'ACTOR_CHANGED' THEN RAISE EXCEPTION 'actor_fence_not_denied'; END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='f7660000-0000-4000-8000-000000000003')<>entry_count
   OR (SELECT revision FROM public.table_sessions WHERE id=sess)<>rev THEN RAISE EXCEPTION 'rejections_mutated_entry_or_revision'; END IF;
 UPDATE public.table_sessions SET closed_at=now() WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Closed TEST',tt,2,sess,rev,epoch,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'table_session_mismatch' THEN RAISE EXCEPTION 'closed_session_not_denied'; END IF;
 PERFORM set_config('role','none',true);
 UPDATE public.table_sessions SET closed_at=NULL WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Second TEST',tt,2,sess,rev,epoch,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'second_participant_failed: %',result; END IF;
 PERFORM set_config('role','none',true);
 SELECT revision INTO rev FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3('f7660000-0000-4000-8000-000000000003',
   'f7660000-0000-4000-8000-000000000012','tracker',gen_random_uuid());
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture_destination_open_failed: %',opened; END IF;
 dest_tt:=(opened->>'tournament_table_id')::uuid; dest_sess:=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','none',true);
 -- Isolated valid pending-source relation; no live queue/fixture insertion.
 INSERT INTO public.floor_pending_tracker_moves(tournament_id,entry_id,source_seat_id,
   source_tournament_table_id,source_table_session_id,destination_tournament_table_id,
   destination_table_session_id,destination_seat_number,source_control_epoch,destination_control_epoch,requested_by,request_id)
 VALUES('f7660000-0000-4000-8000-000000000003',(original->>'entry_id')::uuid,(original->>'seat_id')::uuid,
   tt,sess,dest_tt,dest_sess,1,epoch,1,'f7660000-0000-4000-8000-000000000001',gen_random_uuid()) RETURNING id INTO move_uuid;
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Pending source TEST',tt,3,sess,rev,epoch,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'source_moves_pending' THEN
   RAISE EXCEPTION 'pending_source_accepted_new_participant: %',result; END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='f7660000-0000-4000-8000-000000000003')<>2
   OR (SELECT revision FROM public.table_sessions WHERE id=sess)<>rev
   OR NOT EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves WHERE id=move_uuid AND status='pending') THEN
   RAISE EXCEPTION 'pending_source_denial_mutated_state'; END IF;
 DELETE FROM public.floor_pending_tracker_moves WHERE id=move_uuid;
 SELECT count(*) INTO receipt_count FROM public.table_operation_receipts
   WHERE actor_id='f7660000-0000-4000-8000-000000000001';
 FOR i IN 1..2 LOOP
   fault_key:=gen_random_uuid();
   PERFORM set_config(CASE WHEN i=1 THEN 'test.manual66_audit_fault' ELSE 'test.manual66_receipt_fault' END,'on',true);
   PERFORM set_config('role','authenticated',true);
   BEGIN
     result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Rollback TEST',tt,3,sess,rev,epoch,fault_key,
       'f7660000-0000-4000-8000-000000000001');
     RAISE EXCEPTION 'expected_injected_fault';
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
     IF SQLERRM IS DISTINCT FROM (CASE WHEN i=1 THEN 'manual66_audit_fault' ELSE 'manual66_outer_receipt_fault' END) THEN RAISE; END IF;
   END;
   PERFORM set_config('role','none',true);
   PERFORM set_config(CASE WHEN i=1 THEN 'test.manual66_audit_fault' ELSE 'test.manual66_receipt_fault' END,'off',true);
   IF (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='f7660000-0000-4000-8000-000000000003')<>2
     OR (SELECT count(*) FROM public.tournament_seats WHERE tournament_id='f7660000-0000-4000-8000-000000000003' AND is_active)<>2
     OR (SELECT sum(chip_count) FROM public.tournament_chip_counts WHERE tournament_id='f7660000-0000-4000-8000-000000000003')<>40000
     OR (SELECT revision FROM public.table_sessions WHERE id=sess)<>rev
     OR (SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='f7660000-0000-4000-8000-000000000001')<>receipt_count THEN
     RAISE EXCEPTION 'injected_fault_leaked_entry_seat_projection_revision_or_receipt';
   END IF;
 END LOOP;
 UPDATE public.tournaments SET current_level=1 WHERE id='f7660000-0000-4000-8000-000000000003';
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break)
   VALUES('f7660000-0000-4000-8000-000000000003',1,100,200,0,false);
 INSERT INTO public.tournament_hands(tournament_id,table_id,table_session_id,hand_number,status,button_seat)
   VALUES('f7660000-0000-4000-8000-000000000003',tt,sess,1,'in_progress',1) RETURNING id INTO hand;
 PERFORM set_config('role','authenticated',true);
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Active hand TEST',tt,3,sess,rev,epoch,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000001');
 IF result->>'error' IS DISTINCT FROM 'table_has_active_hand' THEN RAISE EXCEPTION 'active_hand_not_denied: %',result; END IF;
 PERFORM set_config('request.jwt.claim.sub','f7660000-0000-4000-8000-000000000099',true);
 result:=public.get_floor_manual_player_receipt_v1('f7660000-0000-4000-8000-000000000003',key,'f7660000-0000-4000-8000-000000000099');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'foreign_actor_read_not_denied'; END IF;
 result:=public.floor_add_manual_player_v1('f7660000-0000-4000-8000-000000000003','Foreign TEST',tt,3,sess,rev,epoch,gen_random_uuid(),
   'f7660000-0000-4000-8000-000000000099');
 IF result->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'foreign_actor_write_not_denied'; END IF;
 PERFORM set_config('role','none',true);
 IF NOT has_function_privilege('authenticated','public.floor_add_manual_player_v1(uuid,text,uuid,integer,uuid,bigint,bigint,uuid,uuid)','EXECUTE')
   OR has_function_privilege('anon','public.floor_add_manual_player_v1(uuid,text,uuid,integer,uuid,bigint,bigint,uuid,uuid)','EXECUTE')
   OR has_function_privilege('service_role','public.floor_add_manual_player_v1(uuid,text,uuid,integer,uuid,bigint,bigint,uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'manual_player_acl_mismatch'; END IF;
 RAISE NOTICE 'MANUAL_SEAT_SESSION_RECEIPT_RUNTIME_PASS';
END $$;
ROLLBACK;
