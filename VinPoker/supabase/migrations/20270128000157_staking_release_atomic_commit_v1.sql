-- CLI candidate 20261018163404 -> forward slot157. LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_release_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.commit_staking_release_v1(uuid,jsonb)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000157')
 THEN RAISE EXCEPTION 'staking157_catalog_collision';END IF;
END $$;
CREATE TABLE public.staking_release_receipts_v1(
 release_request_id uuid PRIMARY KEY REFERENCES public.staking_release_requests(id),
 actor_id uuid NOT NULL, payload jsonb NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staking_release_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_release_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

-- Service-only boundary: Edge authenticates the caller; DB independently checks actor roles/club.
CREATE FUNCTION public.commit_staking_release_v1(p_actor uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE rr public.staking_release_requests%ROWTYPE; d public.staking_deals%ROWTYPE;
 old_receipt public.staking_release_receipts_v1%ROWTYPE;
 bp jsonb; fp public.staking_purchases%ROWTYPE; rows jsonb:='[]'; row_data jsonb;
 request_id uuid; is_super boolean; is_cashier boolean;
 prize bigint; fee bigint; distributable bigint; backer_amount bigint; player_amount bigint;
 pct numeric; total_pct numeric:=0; allocated bigint:=0; share bigint; n integer; i integer:=0;
 outcome jsonb; stamp timestamptz:=now();
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_actor IS NULL
 THEN RAISE EXCEPTION 'staking_release_service_required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
 OR p_payload->'player_paid' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(p_payload->'backer_payouts') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'staking_release_invalid_payload';END IF;
 request_id:=(p_payload->>'release_request_id')::uuid;
 n:=jsonb_array_length(p_payload->'backer_payouts');
 IF n NOT BETWEEN 1 AND 100 OR length(coalesce(p_payload->>'note',''))>1000
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'backer_payouts') b
   WHERE b->'paid' IS DISTINCT FROM 'true'::jsonb OR b->>'payout_method' NOT IN('cash','bank_transfer')
   OR b->>'payout_method' IS NULL OR b->>'purchase_id' IS NULL)
 OR (SELECT count(DISTINCT (b->>'purchase_id')::uuid) FROM jsonb_array_elements(p_payload->'backer_payouts') b)<>n
 THEN RAISE EXCEPTION 'staking_release_invalid_purchases';END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin'),
   EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='cashier') INTO is_super,is_cashier;
 IF NOT (is_super OR is_cashier) THEN RAISE EXCEPTION 'staking_release_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO rr FROM public.staking_release_requests WHERE id=request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_release_not_found';END IF;
 SELECT * INTO d FROM public.staking_deals WHERE id=rr.deal_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_deal_not_found';END IF;
 IF NOT is_super AND (d.club_id IS NULL OR NOT public.is_club_cashier(p_actor,d.club_id))
 THEN RAISE EXCEPTION 'staking_release_club_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO old_receipt FROM public.staking_release_receipts_v1 WHERE release_request_id=request_id;
 IF FOUND THEN
   IF old_receipt.actor_id IS DISTINCT FROM p_actor OR old_receipt.payload IS DISTINCT FROM p_payload
   THEN RAISE EXCEPTION 'staking_release_payload_conflict';END IF;
   RETURN old_receipt.response;
 END IF;
 IF rr.executed_at IS NOT NULL OR rr.status<>'approved' OR rr.cosigned_by_admin_id IS NULL OR d.status<>'cosigned'
 THEN RAISE EXCEPTION 'staking_release_state_conflict';END IF;
 -- Existing cashier same-person cosign policy is preserved; no new payroll/payout policy.
 IF EXISTS(SELECT 1 FROM public.staking_ledger WHERE release_request_id=request_id OR deal_id=d.id)
 OR EXISTS(SELECT 1 FROM public.payout_recipients WHERE deal_id=d.id)
 THEN RAISE EXCEPTION 'staking_release_legacy_evidence_review_required';END IF;
 PERFORM id FROM public.staking_purchases WHERE deal_id=d.id ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.staking_purchases WHERE deal_id=d.id AND status='funded')<>n
 THEN RAISE EXCEPTION 'staking_release_purchase_set_changed';END IF;
 FOR bp IN SELECT value FROM jsonb_array_elements(p_payload->'backer_payouts') LOOP
   SELECT * INTO fp FROM public.staking_purchases WHERE id=(bp->>'purchase_id')::uuid AND deal_id=d.id AND status='funded';
   IF NOT FOUND OR fp.percent IS NULL OR fp.percent<=0 THEN RAISE EXCEPTION 'staking_release_invalid_purchase';END IF;
   total_pct:=total_pct+fp.percent;
 END LOOP;
 prize:=d.result_prize_vnd; pct:=d.filled_percent;
 IF prize IS NULL OR prize<0 OR pct IS NULL OR pct<=0 OR pct>100 OR total_pct<>pct
 THEN RAISE EXCEPTION 'staking_release_invalid_snapshot';END IF;
 fee:=CASE WHEN prize>0 THEN least(coalesce(d.platform_archive_fee,199000),prize) ELSE 0 END;
 distributable:=greatest(0,prize-fee);
 IF d.override_data->>'override_backer_amount' IS NOT NULL THEN
   backer_amount:=(d.override_data->>'override_backer_amount')::bigint;
   player_amount:=(d.override_data->>'override_player_amount')::bigint;
 ELSE
   backer_amount:=round(distributable*pct/100);player_amount:=greatest(0,distributable-backer_amount);
 END IF;
 IF fee<0 OR backer_amount IS NULL OR player_amount IS NULL OR backer_amount<0 OR player_amount<0
 OR d.backer_payout_vnd IS DISTINCT FROM backer_amount OR d.player_payout_vnd IS DISTINCT FROM player_amount
 THEN RAISE EXCEPTION 'staking_release_amount_mismatch';END IF;
 FOR bp IN SELECT value FROM jsonb_array_elements(p_payload->'backer_payouts') LOOP
   i:=i+1;
   SELECT * INTO STRICT fp FROM public.staking_purchases WHERE id=(bp->>'purchase_id')::uuid;
   share:=CASE WHEN i<n THEN round(backer_amount*fp.percent/total_pct) ELSE greatest(0,backer_amount-allocated) END;
   allocated:=allocated+share;
   rows:=rows||jsonb_build_array(jsonb_build_object('purchase_id',fp.id,'backer_id',fp.backer_id,'percent',fp.percent,
     'amount_vnd',share,'payout_method',bp->>'payout_method','proof_url',bp->>'proof_url'));
 END LOOP;
 IF allocated<>backer_amount THEN RAISE EXCEPTION 'staking_release_rounding_inconsistent';END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(rows) LOOP
   INSERT INTO public.staking_ledger(deal_id,release_request_id,entry_type,amount_vnd,user_id,performed_by,payout_method,proof_url,metadata)
   VALUES(d.id,rr.id,'escrow_out_backer',(row_data->>'amount_vnd')::bigint,(row_data->>'backer_id')::uuid,p_actor,
     row_data->>'payout_method',row_data->>'proof_url',jsonb_build_object('purchase_id',row_data->>'purchase_id',
       'percent',row_data->'percent','cosigner',rr.cosigned_by_admin_id,'requester',rr.requested_by_admin_id,'note',p_payload->>'note','prize_vnd',prize));
   INSERT INTO public.payout_recipients(deal_id,user_id,role,purchase_id,amount_vnd,platform_fee_vnd,method,status,proof_image_url,paid_at)
   VALUES(d.id,(row_data->>'backer_id')::uuid,'backer',(row_data->>'purchase_id')::uuid,(row_data->>'amount_vnd')::bigint,0,
     row_data->>'payout_method','paid',row_data->>'proof_url',stamp);
 END LOOP;
 INSERT INTO public.staking_ledger(deal_id,release_request_id,entry_type,amount_vnd,user_id,performed_by,payout_method,metadata)
 VALUES(d.id,rr.id,'escrow_out_player',player_amount,d.player_id,p_actor,'cash',jsonb_build_object('cosigner',rr.cosigned_by_admin_id,
   'requester',rr.requested_by_admin_id,'note',p_payload->>'note','kept_percent',100-pct,'paid_in_cash_at_club',true));
 INSERT INTO public.payout_recipients(deal_id,user_id,role,purchase_id,amount_vnd,platform_fee_vnd,method,status,paid_at)
 VALUES(d.id,d.player_id,'player',NULL,player_amount,coalesce(d.platform_fee_vnd,0),'cash','paid',stamp);
 UPDATE public.staking_release_requests SET status='executed',executed_at=stamp WHERE id=rr.id;
 UPDATE public.staking_deals SET status='completed',completed_at=stamp WHERE id=d.id;
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(d.id,'payout_executed',p_actor,'cosigned','completed',jsonb_build_object('release_request_id',rr.id,
   'requester',rr.requested_by_admin_id,'cosigner',rr.cosigned_by_admin_id,'amounts',jsonb_build_object('backer',backer_amount,'player',player_amount,'fee',fee),'backer_payouts',rows));
 outcome:=jsonb_build_object('success',true,'status','completed','release_request_id',rr.id,'deal_id',d.id,
   'amounts',jsonb_build_object('backer',backer_amount,'player',player_amount,'fee',fee));
 INSERT INTO public.staking_release_receipts_v1 VALUES(rr.id,p_actor,p_payload,outcome,stamp);
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.commit_staking_release_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_staking_release_v1(uuid,jsonb) TO service_role;
COMMIT;
