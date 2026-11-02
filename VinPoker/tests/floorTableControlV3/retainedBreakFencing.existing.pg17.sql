-- Retained paid journey after actual browser break. No new hand is retained.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c'
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR inet_server_port()<>55441 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='395420ac-28b8-4a9e-a240-eaa82dc0fde3' AND closed_at IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND closed_at IS NULL AND control_mode='manual' AND control_epoch=1)
 THEN RAISE EXCEPTION 'retained_break_local_scope_required'; END IF;
END $$;
CREATE TEMP VIEW retained_break_state AS SELECT md5(jsonb_build_object(
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.table_sessions s WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'proofs',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'))::text) fingerprint;
CREATE TEMP TABLE retained_break_before AS SELECT * FROM retained_break_state;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE stale_break_probes AS
 SELECT 'closed_source' seam,public.start_tracker_hand_v3(
 '46cab483-91e7-4220-aacf-e17bdf05269c','009305c5-308b-4e67-81b1-f1e1e8cc5747',
 '395420ac-28b8-4a9e-a240-eaa82dc0fde3',6,4,now(),'675fe35e-60a8-4452-bb90-e79486d54da6',2) result
 UNION ALL SELECT 'new_manual_session',public.start_tracker_hand_v3(
 '46cab483-91e7-4220-aacf-e17bdf05269c','d294f4a4-082b-4efc-a6ca-1f96579ea344',
 'ee2b9393-0c96-42f9-8667-7f306edeb9bc',1,4,now(),'675fe35e-60a8-4452-bb90-e79486d54da6',1);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM stale_break_probes)<>2 OR EXISTS(
 SELECT 1 FROM stale_break_probes WHERE result->>'error' IS DISTINCT FROM 'STALE_TRACKER_CONTEXT')
 THEN RAISE EXCEPTION 'stale_break_fence_failed: %',(SELECT jsonb_agg(to_jsonb(p)) FROM stale_break_probes p);END IF;
 IF (SELECT fingerprint FROM retained_break_before) IS DISTINCT FROM (SELECT fingerprint FROM retained_break_state)
 THEN RAISE EXCEPTION 'stale_break_fence_changed_state';END IF;
END $$;
SELECT 'RETAINED_CLOSED_SOURCE_AND_MANUAL_DESTINATION_TRACKER_FENCED_NO_DELTA_PASS';
ROLLBACK;
