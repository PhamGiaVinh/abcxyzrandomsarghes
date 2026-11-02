-- Dedicated transaction-only metadata fixture, never either accepted tour journey.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR host(inet_server_addr())<>'127.0.0.1'
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net')
 OR NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
   WHERE t.id='a43f49a7-bf31-4972-8ef9-f6fc2ea9802e' AND c.owner_id='0ba0b14e-ecce-4dbc-b561-5cc48b8cda3d')
 OR EXISTS(SELECT 1 FROM public.booking_chats WHERE tournament_id='a43f49a7-bf31-4972-8ef9-f6fc2ea9802e')
 THEN RAISE EXCEPTION 'booking111_scope_guard';END IF;
END $guard$;
SELECT set_config('test.booking111_id',gen_random_uuid()::text,true);
INSERT INTO public.booking_chats(id,tournament_id,club_id,player_id,archived_at)
SELECT current_setting('test.booking111_id')::uuid,t.id,t.club_id,'0ba0b14e-ecce-4dbc-b561-5cc48b8cda3d','2026-10-18T00:00:00Z'
FROM public.tournaments t WHERE t.id='a43f49a7-bf31-4972-8ef9-f6fc2ea9802e';
SET LOCAL request.jwt.claim.role='authenticated';
-- Retained native auth.uid() reads the legacy transaction-local sub setting.
-- Set both claims representations; do not alter the Auth function to pass tests.
SET LOCAL request.jwt.claim.sub='11100000-0000-4000-8000-000000000111';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"11100000-0000-4000-8000-000000000111"}';
SET LOCAL ROLE authenticated;
DO $outsider$ DECLARE affected integer;BEGIN
 IF auth.uid() IS DISTINCT FROM '11100000-0000-4000-8000-000000000111'::uuid THEN RAISE EXCEPTION 'booking111_outsider_auth_model';END IF;
 IF EXISTS(SELECT 1 FROM public.booking_chats WHERE id=current_setting('test.booking111_id')::uuid) THEN RAISE EXCEPTION 'booking111_outsider_read';END IF;
 UPDATE public.booking_chats SET archived_at=NULL WHERE id=current_setting('test.booking111_id')::uuid AND archived_at='2026-10-18T00:00:00Z';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'booking111_outsider_update';END IF;
END $outsider$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='0ba0b14e-ecce-4dbc-b561-5cc48b8cda3d';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"0ba0b14e-ecce-4dbc-b561-5cc48b8cda3d"}';
SET LOCAL ROLE authenticated;
DO $owner$ DECLARE affected integer;confirmed public.booking_chats%ROWTYPE;BEGIN
 IF auth.uid() IS DISTINCT FROM '0ba0b14e-ecce-4dbc-b561-5cc48b8cda3d'::uuid THEN RAISE EXCEPTION 'booking111_owner_auth_model';END IF;
 UPDATE public.booking_chats SET archived_at=NULL WHERE id=current_setting('test.booking111_id')::uuid AND archived_at='2026-10-17T00:00:00Z';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'booking111_stale_timestamp_updated';END IF;
 UPDATE public.booking_chats SET archived_at=NULL WHERE id=current_setting('test.booking111_id')::uuid AND archived_at='2026-10-18T00:00:00Z' RETURNING * INTO confirmed;
 IF NOT FOUND OR confirmed.id<>current_setting('test.booking111_id')::uuid OR confirmed.archived_at IS NOT NULL THEN RAISE EXCEPTION 'booking111_exact_ack';END IF;
 UPDATE public.booking_chats SET archived_at=NULL WHERE id=current_setting('test.booking111_id')::uuid AND archived_at='2026-10-18T00:00:00Z';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'booking111_repeat_write';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.booking_chats WHERE id=confirmed.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'booking111_readback';END IF;
END $owner$;
RESET ROLE;
ROLLBACK;
SELECT 'BOOKING111_REAL_SQL_RLS_OUTSIDER_ZERO_OWNER_CAS_ACK_RETRY_ZERO_READBACK_ROLLBACK_PASS';
