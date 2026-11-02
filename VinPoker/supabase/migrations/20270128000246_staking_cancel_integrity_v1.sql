-- CLI candidate20261023135632 -> forward slot246. LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE oid=to_regprocedure('public.auto_cancel_expired_commits()'))
 IS DISTINCT FROM '8fdc0faaca88ff75217fcdcaa82d6141'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000246')
 THEN RAISE EXCEPTION 'staking246_catalog_drift';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.auto_cancel_expired_commits()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate uuid; d public.staking_deals%ROWTYPE; p public.staking_purchases%ROWTYPE;
 cnt integer:=0; total integer; had_release boolean;
BEGIN
 FOR candidate IN SELECT id FROM public.staking_deals
  WHERE status IN('committing','committed') OR EXISTS(
   SELECT 1 FROM public.staking_purchases WHERE deal_id=staking_deals.id
   AND status='committed' AND committed_at<now()-interval '30 minutes') ORDER BY id
 LOOP
  -- One busy deal must not block the scheduler or invert a legacy purchase lock.
  BEGIN
   PERFORM id FROM public.staking_release_requests WHERE deal_id=candidate ORDER BY id FOR UPDATE NOWAIT;
   had_release:=FOUND;
   SELECT * INTO d FROM public.staking_deals WHERE id=candidate FOR UPDATE NOWAIT;
   IF NOT FOUND THEN CONTINUE;END IF;
   IF NOT had_release AND EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=candidate)
   THEN CONTINUE;END IF;
   PERFORM id FROM public.staking_purchases WHERE deal_id=candidate ORDER BY id FOR UPDATE NOWAIT;
   FOR p IN SELECT * FROM public.staking_purchases WHERE deal_id=candidate
    AND status='committed' AND committed_at<now()-interval '30 minutes' ORDER BY id
   LOOP
    UPDATE public.staking_purchases SET status='auto_cancelled',cancelled_at=now(),
     cancellation_reason='Backer did not complete bank transfer within 30 minutes' WHERE id=p.id;
    -- Status trigger already derives filled_percent; never subtract it again.
    INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
    VALUES(candidate,'auto_cancelled_timeout',NULL,'committed','cancelled',
     jsonb_build_object('purchase_id',p.id,'released_backer_id',p.backer_id,'percent',p.percent));
    cnt:=cnt+1;
   END LOOP;
   SELECT coalesce(sum(percent),0)::integer INTO total FROM public.staking_purchases
    WHERE deal_id=candidate AND status IN('committed','funded');
   UPDATE public.staking_deals SET filled_percent=total WHERE id=candidate;
   IF d.status IN('committing','committed') THEN
    IF total=0 THEN
     IF d.early_closed THEN
      UPDATE public.staking_deals SET status='cancelled',cancellation_reason='early_closed_no_funded' WHERE id=candidate;
     ELSE
      UPDATE public.staking_deals SET status='listing',cancellation_reason='auto_cancelled_timeout' WHERE id=candidate;
     END IF;
    ELSIF total<d.percentage_sold AND d.status<>'committing' THEN
     UPDATE public.staking_deals SET status='committing' WHERE id=candidate;
    END IF;
   END IF;
  EXCEPTION WHEN lock_not_available THEN
   -- The subtransaction releases every lock acquired for this busy deal.
   NULL;
  END;
 END LOOP;
 RETURN cnt;
END $$;
-- Preserve existing service-only ACL; CREATE OR REPLACE retains ownership/grants.
COMMIT;
