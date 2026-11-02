BEGIN;
SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$ DECLARE club uuid; a jsonb; b jsonb; c jsonb; r jsonb; original timestamptz;
BEGIN
 SELECT c.id INTO STRICT club FROM public.clubs c JOIN public.tournaments t ON t.club_id=c.id
 JOIN public.club_payment_config cfg ON cfg.club_id=c.id WHERE t.id='e77ceb98-7e77-4c87-bd73-787c6de20936'
 AND t.name='Cash identity local TEST' AND c.name='Cash identity local TEST' AND cfg.master_account_number LIKE 'TEST-%';
 ASSERT NOT EXISTS(SELECT FROM private.sepay_pull_progress_v1 WHERE club_id=club);
 SELECT last_pull_at INTO original FROM public.club_payment_config WHERE club_id=club;
 a:=public.sepay_claim_pull_v2(club,'51100000-0000-4000-8000-000000000001');
 ASSERT a->'provider_total'='null'::jsonb;
 r:=public.sepay_checkpoint_pull_v2(club,(a->>'lease_token')::uuid,1,6,false,503);ASSERT r->>'ok'='true';
 b:=public.sepay_claim_pull_v2(club,'51100000-0000-4000-8000-000000000001');ASSERT (b->>'provider_total')::int=503;
 r:=public.sepay_checkpoint_pull_v2(club,(b->>'lease_token')::uuid,6,7,true,504);
 ASSERT r->>'restart_required'='true';
 ASSERT (SELECT last_pull_at IS NOT DISTINCT FROM original FROM public.club_payment_config WHERE club_id=club);
 c:=public.sepay_claim_pull_v2(club,'51100000-0000-4000-8000-000000000001');
 ASSERT (c->>'next_page')::int=1 AND c->>'window_from'=a->>'window_from' AND c->>'window_to'=a->>'window_to';
 BEGIN
  PERFORM public.sepay_checkpoint_pull_v2(club,(b->>'lease_token')::uuid,1,6,false,999);
  RAISE EXCEPTION 'stale_restart_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stale_pull_lease' THEN RAISE; END IF; END;
 r:=public.sepay_checkpoint_pull_v2(club,(c->>'lease_token')::uuid,1,6,false,504);
 c:=public.sepay_claim_pull_v2(club,'51100000-0000-4000-8000-000000000001');
 r:=public.sepay_checkpoint_pull_v2(club,(c->>'lease_token')::uuid,6,7,true,504);ASSERT r->>'complete'='true';
 ASSERT (SELECT last_pull_at=(a->>'window_to')::timestamptz FROM public.club_payment_config WHERE club_id=club);
 ASSERT NOT has_function_privilege('service_role','public.sepay_claim_pull_v1(uuid,uuid)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.sepay_claim_pull_v2(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.sepay_claim_pull_v2(uuid,uuid)','EXECUTE');
END $$;
SELECT 'SEPAY_TOTAL_CHANGED_RESET_SAME_WINDOW_STALE_LEASE_DENIED_504_COMPLETE_PASS';
ROLLBACK;
