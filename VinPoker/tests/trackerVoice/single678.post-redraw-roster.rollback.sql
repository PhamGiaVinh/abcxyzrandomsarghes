\set ON_ERROR_STOP on
-- Canonical readers take row locks; exercise them in a rollback-only transaction.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND hand_number>=4);
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.get_tracker_roster_snapshot_v2('c367013a-3ed3-48af-ad48-3915acadc50e','c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5',5);
 ASSERT r->>'ok'='true',r::text;
 ASSERT (SELECT count(*)=8 AND sum((s->'seat'->>'chip_count')::numeric)=180000 FROM jsonb_array_elements(r->'seats') s WHERE s->'seat'<>'null'::jsonb);
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'seats') s WHERE s->'seat'->>'entry_id'='86dc0814-e2f2-46ee-86f0-a68e9f57d6b7' AND s->'seat'->>'entry_number'='2' AND s->'seat'->>'seat_number'='3');
 r:=public.get_tracker_roster_snapshot_v2('c367013a-3ed3-48af-ad48-3915acadc50e','c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5',4);
 ASSERT r->>'ok'='false','stale epoch4 roster must be denied';
 r:=public.start_tracker_hand_v3('c367013a-3ed3-48af-ad48-3915acadc50e','c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5',4,4,now(),'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',1);
 ASSERT r->>'error'='STALE_TRACKER_CONTEXT',r::text;
END $$;
ROLLBACK;
SELECT 'SINGLE678_CURRENT_EPOCH5_ROSTER_ENTRY2_180K_STALE4_READ_AND_START_DENIED_PASS';
