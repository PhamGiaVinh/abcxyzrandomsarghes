-- CLI candidate20261023140643 -> forward slot249. LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_purchase_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.commit_staking_purchase_v1(uuid,uuid,uuid,integer)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000249')
 THEN RAISE EXCEPTION 'staking249_catalog_collision';END IF;
END $$;
CREATE TABLE public.staking_purchase_receipts_v1(
 actor_id uuid NOT NULL,request_id uuid NOT NULL,deal_id uuid NOT NULL REFERENCES public.staking_deals(id),
 purchase_id uuid NOT NULL UNIQUE REFERENCES public.staking_purchases(id),
 payload jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE public.staking_purchase_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_purchase_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.commit_staking_purchase_v1(p_actor uuid,p_request uuid,p_deal uuid,p_percent integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE; r public.staking_purchase_receipts_v1%ROWTYPE;
 b public.platform_bank_accounts%ROWTYPE; profile_row public.profiles%ROWTYPE;
 had_release boolean; filled integer; amount_value bigint; purchase uuid:=gen_random_uuid();
 reference_value text; next_status public.staking_deal_status; intent jsonb; result jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'staking_purchase_service_required' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR p_request IS NULL OR p_deal IS NULL OR p_percent IS NULL OR p_percent NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'staking_purchase_invalid_payload';END IF;
 PERFORM id FROM public.staking_release_requests WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 had_release:=FOUND;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_purchase_not_found';END IF;
 IF d.player_id=p_actor THEN RAISE EXCEPTION 'staking_purchase_self_denied' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor) THEN RAISE EXCEPTION 'staking_purchase_actor_denied' USING ERRCODE='42501';END IF;
 intent:=jsonb_build_object('deal_id',p_deal,'percent',p_percent);
 SELECT * INTO r FROM public.staking_purchase_receipts_v1 WHERE actor_id=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF r.payload IS DISTINCT FROM intent THEN RAISE EXCEPTION 'staking_purchase_payload_conflict';END IF;
  RETURN r.response;
 END IF;
 IF NOT had_release AND EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=p_deal)
 THEN RAISE EXCEPTION 'staking_purchase_retry_snapshot' USING ERRCODE='40001';END IF;
 IF d.status NOT IN('listing','committing') OR d.early_closed OR d.admin_review_status IS DISTINCT FROM 'approved'
 OR (d.registration_deadline IS NOT NULL AND d.registration_deadline<now())
 THEN RAISE EXCEPTION 'staking_purchase_state_conflict';END IF;
 SELECT * INTO profile_row FROM public.profiles WHERE user_id=p_actor FOR SHARE;
 IF profile_row.bank_account_number IS NULL OR profile_row.bank_name IS NULL OR profile_row.bank_account_holder IS NULL
 OR profile_row.bank_account_number='' OR profile_row.bank_name='' OR profile_row.bank_account_holder=''
 THEN RAISE EXCEPTION 'staking_purchase_bank_profile_required';END IF;
 SELECT * INTO b FROM public.platform_bank_accounts WHERE account_type='escrow' AND is_active
 AND (club_id=d.club_id OR club_id IS NULL)
 ORDER BY (club_id IS NOT NULL) DESC,created_at DESC,id LIMIT 1 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_purchase_escrow_bank_required';END IF;
 PERFORM id FROM public.staking_purchases WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 SELECT coalesce(sum(percent),0)::integer INTO filled FROM public.staking_purchases
 WHERE deal_id=p_deal AND status IN('committed','funded');
 IF p_percent<coalesce(d.min_purchase_percent,5) AND p_percent<>d.percentage_sold-filled
 THEN RAISE EXCEPTION 'staking_purchase_minimum';END IF;
 IF filled+p_percent>d.percentage_sold THEN RAISE EXCEPTION 'staking_purchase_capacity_conflict';END IF;
 -- Existing positive-VND Math.round rule, computed authoritatively with exact numeric inputs.
 amount_value:=round(d.buy_in_amount_vnd::numeric*p_percent/100*d.markup)::bigint;
 reference_value:='VIN'||upper(substr(replace(p_deal::text,'-',''),1,6))||'-'||upper(replace(purchase::text,'-',''));
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,reference_code,status)
 VALUES(purchase,p_deal,p_actor,p_percent,d.markup,amount_value,reference_value,'committed');
 filled:=filled+p_percent;
 next_status:=CASE WHEN filled>=d.percentage_sold THEN 'committed'::public.staking_deal_status ELSE 'committing'::public.staking_deal_status END;
 UPDATE public.staking_deals SET filled_percent=filled,status=next_status WHERE id=p_deal;
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(p_deal,'committed',p_actor,d.status,next_status,jsonb_build_object('purchase_id',purchase,
 'percent',p_percent,'amount_vnd',amount_value,'reference_code',reference_value,'filled_percent',filled,'request_id',p_request));
 result:=jsonb_build_object('success',true,'purchase_id',purchase,'reference_code',reference_value,'amount_vnd',amount_value,
 'bank_name',b.bank_name,'account_number',b.account_number,'account_holder',b.account_holder,'qr_code_url',b.qr_code_url,
 'deal_status',next_status,'filled_percent',filled);
 INSERT INTO public.staking_purchase_receipts_v1(actor_id,request_id,deal_id,purchase_id,payload,response)
 VALUES(p_actor,p_request,p_deal,purchase,intent,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.commit_staking_purchase_v1(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_staking_purchase_v1(uuid,uuid,uuid,integer) TO service_role;
COMMIT;
