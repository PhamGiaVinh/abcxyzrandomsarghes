-- CLI candidate20261023140051 -> forward slot247. LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_close_early_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.close_staking_deal_early_v1(uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000247')
 THEN RAISE EXCEPTION 'staking247_catalog_collision';END IF;
END $$;
CREATE TABLE public.staking_close_early_receipts_v1(
 deal_id uuid PRIMARY KEY REFERENCES public.staking_deals(id), actor_id uuid NOT NULL,
 response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staking_close_early_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_close_early_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.close_staking_deal_early_v1(p_actor uuid,p_deal uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE; r public.staking_close_early_receipts_v1%ROWTYPE;
 had_release boolean; total integer; next_status public.staking_deal_status; result jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'staking_close_service_required' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR p_deal IS NULL THEN RAISE EXCEPTION 'staking_close_invalid_payload';END IF;
 PERFORM id FROM public.staking_release_requests WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 had_release:=FOUND;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_close_not_found';END IF;
 IF d.player_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'staking_close_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.staking_close_early_receipts_v1 WHERE deal_id=p_deal;
 IF FOUND THEN
  IF r.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'staking_close_receipt_conflict';END IF;
  RETURN r.response;
 END IF;
 IF d.early_closed OR d.status NOT IN('listing','committing') THEN RAISE EXCEPTION 'staking_close_state_conflict';END IF;
 IF NOT had_release AND EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=p_deal)
 THEN RAISE EXCEPTION 'staking_close_retry_snapshot' USING ERRCODE='40001';END IF;
 PERFORM id FROM public.staking_purchases WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 SELECT coalesce(sum(percent),0)::integer INTO total FROM public.staking_purchases
 WHERE deal_id=p_deal AND status IN('committed','funded');
 next_status:=d.status;
 IF total=0 THEN next_status:='cancelled';
 ELSIF d.status='committing' THEN next_status:='committed';END IF;
 UPDATE public.staking_deals SET early_closed=true,early_closed_at=now(),status=next_status,
 cancellation_reason=CASE WHEN next_status='cancelled' THEN 'early_closed_no_purchases' ELSE NULL END WHERE id=p_deal;
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(p_deal,'player_close_early',p_actor,d.status,next_status,jsonb_build_object('filled_percent',total,'early_closed',true));
 result:=jsonb_build_object('success',true,'deal_status',next_status,'filled_percent',total);
 INSERT INTO public.staking_close_early_receipts_v1(deal_id,actor_id,response) VALUES(p_deal,p_actor,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.close_staking_deal_early_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.close_staking_deal_early_v1(uuid,uuid) TO service_role;
COMMIT;
