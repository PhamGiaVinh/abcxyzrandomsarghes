-- Exact retained synthetic account; rollback all progress/config probes.
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$
DECLARE club uuid; bank uuid:='51100000-0000-4000-8000-000000000001'; a jsonb; b jsonb; result jsonb; initial_stamp timestamptz;
BEGIN
 SELECT c.id INTO STRICT club FROM public.clubs c JOIN public.tournaments t ON t.club_id=c.id
 JOIN public.club_payment_config cfg ON cfg.club_id=c.id
 WHERE t.id='e77ceb98-7e77-4c87-bd73-787c6de20936' AND t.name='Cash identity local TEST'
 AND c.name='Cash identity local TEST' AND cfg.master_account_number LIKE 'TEST-%';
 ASSERT NOT EXISTS(SELECT FROM private.sepay_pull_progress_v1 WHERE club_id=club),'probe must own a fresh progress row';
 SELECT last_pull_at INTO initial_stamp FROM public.club_payment_config WHERE club_id=club;
 a:=public.sepay_claim_pull_v1(club,bank);
 ASSERT a->>'status'='claimed' AND (a->>'next_page')::int=1;
 b:=public.sepay_claim_pull_v1(club,bank);
 ASSERT b=jsonb_build_object('status','busy');
 BEGIN
  PERFORM public.sepay_checkpoint_pull_v1(club,gen_random_uuid(),1,6,false);
  RAISE EXCEPTION 'wrong_token_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stale_pull_lease' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.sepay_checkpoint_pull_v1(club,(a->>'lease_token')::uuid,1,7,false);
  RAISE EXCEPTION 'unbounded_pages_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_pull_checkpoint' THEN RAISE; END IF; END;
 result:=public.sepay_checkpoint_pull_v1(club,(a->>'lease_token')::uuid,1,6,false);
 ASSERT result=jsonb_build_object('ok',true,'complete',false,'next_page',6);
 ASSERT (SELECT last_pull_at IS NOT DISTINCT FROM initial_stamp FROM public.club_payment_config WHERE club_id=club);
 b:=public.sepay_claim_pull_v1(club,bank);
 ASSERT (b->>'next_page')::int=6 AND b->>'window_from'=a->>'window_from' AND b->>'window_to'=a->>'window_to';
 UPDATE private.sepay_pull_progress_v1 SET lease_until=clock_timestamp()-interval '1 second' WHERE club_id=club;
 a:=public.sepay_claim_pull_v1(club,bank);
 ASSERT a->>'lease_token'<>b->>'lease_token' AND (a->>'next_page')::int=6;
 BEGIN
  PERFORM public.sepay_checkpoint_pull_v1(club,(b->>'lease_token')::uuid,6,7,true);
  RAISE EXCEPTION 'expired_worker_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stale_pull_lease' THEN RAISE; END IF; END;
 result:=public.sepay_checkpoint_pull_v1(club,(a->>'lease_token')::uuid,6,7,true);
 ASSERT result->>'complete'='true';
 ASSERT (SELECT last_pull_at=(a->>'window_to')::timestamptz FROM public.club_payment_config WHERE club_id=club);
 BEGIN
  PERFORM public.sepay_checkpoint_pull_v1(club,(a->>'lease_token')::uuid,6,7,true);
  RAISE EXCEPTION 'finished_worker_replayed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stale_pull_lease' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.sepay_claim_pull_v1(club,gen_random_uuid());
  RAISE EXCEPTION 'changed_bank_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'sepay_pull_account_changed' THEN RAISE; END IF; END;
 ASSERT NOT has_table_privilege('service_role','private.sepay_pull_progress_v1','SELECT,INSERT,UPDATE,DELETE');
 ASSERT NOT has_function_privilege('authenticated','public.sepay_claim_pull_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.sepay_checkpoint_pull_v1(uuid,uuid,integer,integer,boolean)','EXECUTE');
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='private.sepay_pull_progress_v1'::regclass);
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 BEGIN
  PERFORM public.sepay_claim_pull_v1(club,bank);
  RAISE EXCEPTION 'human_service_claim_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','',true);
END $$;
DO $$ BEGIN
 SET LOCAL ROLE anon;
 BEGIN
  PERFORM public.sepay_claim_pull_v1('00000000-0000-4000-8000-000000000001','51100000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'anonymous_claim_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
END $$;
SELECT 'SEPAY_PULL_FIXED_WINDOW_PAGE6_FENCED_RECLAIM_COMPLETE_WATERMARK_ROLLBACK_PASS';
ROLLBACK;
