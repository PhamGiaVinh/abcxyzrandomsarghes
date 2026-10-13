\set ON_ERROR_STOP on
-- Isolated retained-schema PG17 only. Prove the public create→bust→read seam.
DO $$ BEGIN
 IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
   OR current_database() NOT LIKE 'vinpoker_ops_floor66_%'
   OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
   RAISE EXCEPTION 'manual_restore_isolated_runtime_required'; END IF;
END $$;
BEGIN;
INSERT INTO auth.users(id) VALUES('f7670000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7670000-0000-4000-8000-000000000002','f7670000-0000-4000-8000-000000000001','Manual restore TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,starting_stack) VALUES
 ('f7670000-0000-4000-8000-000000000003','f7670000-0000-4000-8000-000000000002','Manual restore TEST','active','registering',20000);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7670000-0000-4000-8000-000000000011','f7670000-0000-4000-8000-000000000002','Manual restore TEST',79,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7670000-0000-4000-8000-000000000001',true);
DO $$
DECLARE opened jsonb; created jsonb; busted jsonb; restored jsonb; replayed jsonb; entry uuid; tt uuid; sess uuid; rev bigint; epoch bigint;
 restore_key uuid:=gen_random_uuid();
 proof record;
BEGIN
 PERFORM set_config('role','authenticated',true);
 opened:=public.floor_open_tournament_table_v3('f7670000-0000-4000-8000-000000000003',
   'f7670000-0000-4000-8000-000000000011','manual',gen_random_uuid());
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'manual_restore_open_failed: %',opened; END IF;
 tt:=(opened->>'tournament_table_id')::uuid;sess:=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','none',true);
 SELECT revision,control_epoch INTO rev,epoch FROM public.table_sessions WHERE id=sess;
 PERFORM set_config('role','authenticated',true);
 created:=public.floor_add_manual_player_v1('f7670000-0000-4000-8000-000000000003','Manual restore person TEST',
   tt,1,sess,rev,epoch,gen_random_uuid(),'f7670000-0000-4000-8000-000000000001');
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
 replayed:=public.floor_restore_busted_player_to_seat_v5(entry,tt,1,rev,epoch,restore_key,sess);
 IF replayed IS DISTINCT FROM restored THEN RAISE EXCEPTION 'manual_restore_replay_changed'; END IF;
 replayed:=public.floor_restore_busted_player_to_seat_v5(entry,tt,2,rev,epoch,restore_key,sess);
 IF replayed->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'manual_restore_changed_payload_accepted'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_floor_restorable_entries_v3('f7670000-0000-4000-8000-000000000003') WHERE entry_id=entry) THEN
   RAISE EXCEPTION 'manual_restore_active_entry_still_offered'; END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.tournament_entries WHERE id=entry AND registration_id IS NULL AND current_stack=20000 AND status='seated')<>1
   OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id=entry AND is_active AND chip_count=20000)<>1
   OR (SELECT count(*) FROM public.tournament_seats WHERE entry_id=entry AND is_active)<>1
   OR (SELECT count(*) FROM public.tournament_chip_counts c JOIN public.tournament_entries e
     ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no
     WHERE e.id=entry AND c.chip_count=20000)<>1 THEN
   RAISE EXCEPTION 'manual_restore_entry_stack_conservation_failed'; END IF;
END $$;
ROLLBACK;
