-- Exact retained local TEST only. Every statement, including a bad restore,
-- is rolled back. Never apply to production or seed/repair participation here.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c'
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR inet_server_port()<>55441 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='ba840f18-085a-430a-918a-6fca24d8c9ca' AND status='completed' AND source_revision=19)
 OR NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='ce2e4ef8-7c36-4f01-9e93-efcfd5464dc9' AND status='busted')
 OR NOT EXISTS(SELECT 1 FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
   WHERE t.id='d294f4a4-082b-4efc-a6ca-1f96579ea344' AND t.status='active'
   AND t.tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'
   AND s.id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND s.closed_at IS NULL)
 THEN RAISE EXCEPTION 'retained_restore_local_scope_required';END IF;
END $$;
CREATE TEMP TABLE restore_snapshot AS SELECT md5(jsonb_build_object(
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'))::text) fingerprint;
GRANT USAGE ON SCHEMA auth TO authenticated;
SELECT revision AS restore_revision, control_epoch AS restore_epoch FROM public.table_sessions
 WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' \gset
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE restore_probe AS SELECT public.floor_restore_busted_player_to_seat_v5(
 'ce2e4ef8-7c36-4f01-9e93-efcfd5464dc9','d294f4a4-082b-4efc-a6ca-1f96579ea344',7,
 :restore_revision, :restore_epoch,
 gen_random_uuid(),'ee2b9393-0c96-42f9-8667-7f306edeb9bc') result;
RESET ROLE;
DO $$ DECLARE result jsonb; BEGIN
 SELECT p.result INTO result FROM restore_probe p;
 IF result->>'error' IS DISTINCT FROM 'restore_stack_evidence_missing' THEN
  RAISE EXCEPTION 'ZERO_STACK_RESTORE_NOT_REJECTED: %',result;END IF;
 IF (SELECT fingerprint FROM restore_snapshot) IS DISTINCT FROM md5(jsonb_build_object(
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'),
 'session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'))::text)
 THEN RAISE EXCEPTION 'DENIED_RESTORE_CHANGED_STATE';END IF;
END $$;
SELECT 'RETAINED_ZERO_STACK_RESTORE_DENIED_NO_DELTA_PASS';
ROLLBACK;
