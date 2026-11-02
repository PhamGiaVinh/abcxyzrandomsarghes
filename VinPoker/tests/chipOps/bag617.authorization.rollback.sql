\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM auth.users WHERE id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 ASSERT NOT public.is_club_owner('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 ASSERT NOT public.is_club_chip_master('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.chip_ops_day_reconcile('46cab483-91e7-4220-aacf-e17bdf05269c',1);
  RAISE EXCEPTION 'BAG617_UNAUTHORIZED_RECONCILIATION_READ_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'BAG617_OUTSIDER_DENIED_ROLLBACK_PASS';
