\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e' AND club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false; changed integer; BEGIN
 BEGIN
  UPDATE public.tournaments SET guarantee_amount=-1 WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e';
  GET DIAGNOSTICS changed=ROW_COUNT;
  ASSERT changed=1,'direct400_actor_update_not_reached';
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE NOTICE 'DIRECT400_NEGATIVE_GTD_ACCEPTED_VIA_REAL_AUTHENTICATED_UPDATE';END IF;
 ASSERT denied,'direct400_negative_gtd_must_be_denied';
END $$;
ROLLBACK;
