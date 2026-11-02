\set ON_ERROR_STOP on
-- Snapshot RPC takes FOR SHARE; READ ONLY rejects that lock. This bounded
-- transaction performs reads, then rolls back; do not weaken the server lock.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.get_tournament_participation_counts_v1('c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT r->'counts'->>'remaining'='8' AND r->'counts'->>'total_entries'='9' AND r->'counts'->>'re_entries'='1' AND r->'counts'->>'live_entry_stack'='180000' AND r->>'average_stack'='22500',r::text;
 r:=public.get_tracker_hand_input_tables_v4('c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT r->>'ok'='true' AND jsonb_array_length(r->'tables')=2 AND r->'invalid_tables'='[]'::jsonb,r::text;
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'tables') t WHERE t->>'table_number'='30' AND t->>'player_count'='7' AND t->>'control_epoch'='4' AND t->>'table_session_id'='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'tables') t WHERE t->>'table_number'='31' AND t->>'player_count'='1' AND t->>'control_mode'='manual' AND t->>'table_session_id'='f60106c2-7ed5-4be3-8512-602b16eddff3');
 r:=public.get_tracker_roster_snapshot_v2('c367013a-3ed3-48af-ad48-3915acadc50e','c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5',4);
 ASSERT r->>'ok'='true',r::text;
 ASSERT (SELECT count(*)=7 AND sum((s->'seat'->>'chip_count')::numeric)=160000 FROM jsonb_array_elements(r->'seats') s WHERE s->'seat'<>'null'::jsonb);
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'seats') s WHERE s->'seat'->>'entry_id'='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e');
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"anon"}';
SET LOCAL ROLE anon;
DO $$ DECLARE r jsonb; BEGIN
 SELECT to_jsonb(s) INTO r FROM public.get_public_tournament_clock_summary('c367013a-3ed3-48af-ad48-3915acadc50e') s;
 ASSERT r->>'entries'='9' AND r->>'players_remaining'='8' AND r->>'average_stack'='22500' AND r->>'small_blind'='100' AND r->>'big_blind'='200',r::text;
END $$;
ROLLBACK;
SELECT 'SINGLE669_FLOOR_TRACKER_PUBLIC_COUNTS_ENTRY_GENERATION_SESSION_PROJECTION_PASS';
