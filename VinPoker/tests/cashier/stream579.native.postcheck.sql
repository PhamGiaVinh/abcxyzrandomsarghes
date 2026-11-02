BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_streams WHERE id='71d24aca-cabb-40e3-9902-17268ef3404a'
  AND tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'
  AND scheduled_at='2026-10-24T10:15:22.123Z' AND NOT is_live
  AND created_by='675fe35e-60a8-4452-bb90-e79486d54da6'
  AND title='LOCAL579 stream schedule TEST' AND updated_at>created_at);
END $$;
-- Native schema bootstrap compatibility only, transaction always rolls back.
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $$ DECLARE changed integer; BEGIN
 WITH denied AS (UPDATE public.tournament_streams SET title='SHOULD_NOT_WRITE'
  WHERE id='71d24aca-cabb-40e3-9902-17268ef3404a' RETURNING id)
 SELECT count(*) INTO changed FROM denied;
 ASSERT changed=0;
 RAISE NOTICE 'STREAM579_EXACT_INSTANT_OFF_NATIVE_COMMIT_AND_OTHER_CLUB_RLS_DENIED_PASS';
END $$;
ROLLBACK;
