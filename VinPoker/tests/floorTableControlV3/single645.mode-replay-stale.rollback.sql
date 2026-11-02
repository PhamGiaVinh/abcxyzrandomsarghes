\set ON_ERROR_STOP on
-- Run after actual375 UI switched original table30 manual→tracker, before hand1.
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND control_mode='tracker' AND control_epoch=2 AND revision=6);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_request_table_control_mode_v4('c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','tracker',5,1,'5da6d8f1-9503-4978-97a8-a7f07f8ea592');
 ASSERT r->>'outcome'='applied' AND r->>'request_id'='a450b516-bff3-4a1f-a2be-0aab8e8b5488',r::text;
 r:=public.floor_request_table_control_mode_v4('c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','manual',5,1,'e6450000-0000-4000-8000-000000000001');
 ASSERT r->>'error'='STALE_STATE',r::text;
 r:=public.start_tracker_hand_v3('c367013a-3ed3-48af-ad48-3915acadc50e','c2ce77c0-2b61-4a19-bd43-4752232cc55a','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5',1,1,statement_timestamp(),'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',6);
 ASSERT r->>'error'='STALE_TRACKER_CONTEXT',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT control_epoch=2 AND revision=6 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');
END $$;
SELECT pg_temp.single638_facts()=:'before' AS unchanged_inside \gset
\if :unchanged_inside
\else
DO $$ BEGIN RAISE EXCEPTION 'single645_replay_stale_changed_operational_facts'; END $$;
\endif
ROLLBACK;
SELECT 'SINGLE645_UI_MODE_REPLAY_STALE_MODE_AND_TRACKER_START_DENIED_PASS';
