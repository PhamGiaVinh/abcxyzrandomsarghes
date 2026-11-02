-- CLI candidate20261023180646 -> reserved forward263. LOCAL ONLY, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.staking_listing_archive_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.archive_staking_listing_v1(uuid,uuid,text)') IS NOT NULL
 OR to_regprocedure('public.get_staking_listing_archive_receipt_v1(uuid,uuid,text)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000263')
 OR md5(pg_get_functiondef('public.fn_deal_notify()'::regprocedure)) IS DISTINCT FROM '8550f370cab2e9cf8cc6e40eba2b7b29'
 OR md5(pg_get_functiondef('public.trg_staking_audit()'::regprocedure)) IS DISTINCT FROM '32693203d48de47c19bd1743905e3f77'
 THEN RAISE EXCEPTION 'staking263_catalog_drift';END IF;
END $$;
CREATE TABLE public.staking_listing_archive_receipts_v1(
 deal_id uuid PRIMARY KEY REFERENCES public.staking_deals(id),actor_id uuid NOT NULL,
 expected_review text NOT NULL CHECK(expected_review IN('approved','rejected')),
 response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staking_listing_archive_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staking_listing_archive_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.archive_staking_listing_v1(p_actor uuid,p_deal uuid,p_expected_review text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE;after_deal public.staking_deals%ROWTYPE;r public.staking_listing_archive_receipts_v1%ROWTYPE;result jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_actor IS NULL
 THEN RAISE EXCEPTION 'staking_archive_forbidden' USING ERRCODE='42501';END IF;
 -- Serialize role revocation with this operation; never reuse a preflight role after waiting.
 PERFORM 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_archive_forbidden' USING ERRCODE='42501';END IF;
 IF p_deal IS NULL OR p_expected_review IS NULL OR p_expected_review NOT IN('approved','rejected')
 THEN RAISE EXCEPTION 'staking_archive_invalid_payload';END IF;
 -- Same release -> deal -> ordered purchases lock order as funding/close paths.
 PERFORM id FROM public.staking_release_requests WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_archive_not_found';END IF;
 SELECT * INTO r FROM public.staking_listing_archive_receipts_v1 WHERE deal_id=p_deal;
 IF FOUND THEN
  IF r.actor_id IS DISTINCT FROM p_actor OR r.expected_review IS DISTINCT FROM p_expected_review
  OR d.status<>'cancelled' OR d.cancellation_reason IS DISTINCT FROM 'reviewed_listing_archived'
  THEN RAISE EXCEPTION 'staking_archive_receipt_conflict';END IF;
  RETURN r.response;
 END IF;
 IF d.status<>'listing' OR d.admin_review_status::text IS DISTINCT FROM p_expected_review
 OR d.backer_id IS NOT NULL OR d.escrow_locked_at IS NOT NULL
 THEN RAISE EXCEPTION 'staking_archive_state_conflict';END IF;
 PERFORM id FROM public.staking_purchases WHERE deal_id=p_deal ORDER BY id FOR UPDATE;
 IF FOUND OR EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.escrow_funding_proofs WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.payout_recipients WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.staking_release_requests WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.staking_purchase_receipts_v1 WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.staking_legacy_funding_receipts_v1 WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.staking_refund_receipts_v1 WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.staking_refund_email_intents_v1 WHERE deal_id=p_deal)
 OR EXISTS(SELECT 1 FROM public.staking_close_early_receipts_v1 WHERE deal_id=p_deal)
 THEN RAISE EXCEPTION 'staking_archive_dependencies_present';END IF;
 UPDATE public.staking_deals SET status='cancelled',cancellation_reason='reviewed_listing_archived' WHERE id=p_deal RETURNING * INTO after_deal;
 IF NOT FOUND OR (to_jsonb(after_deal)-ARRAY['status','cancellation_reason','updated_at']) IS DISTINCT FROM (to_jsonb(d)-ARRAY['status','cancellation_reason','updated_at'])
 THEN RAISE EXCEPTION 'staking_archive_unexpected_mutation';END IF;
 INSERT INTO public.staking_audit_logs(deal_id,action,performed_by,old_status,new_status,metadata)
 VALUES(p_deal,'updated',p_actor,'listing','cancelled',jsonb_build_object('operation','archive_reviewed_listing','expected_review',p_expected_review));
 result:=jsonb_build_object('success',true,'deal_id',p_deal,'status','cancelled','archived',true);
 INSERT INTO public.staking_listing_archive_receipts_v1(deal_id,actor_id,expected_review,response) VALUES(p_deal,p_actor,p_expected_review,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.archive_staking_listing_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.archive_staking_listing_v1(uuid,uuid,text) TO service_role;
CREATE FUNCTION public.get_staking_listing_archive_receipt_v1(p_actor uuid,p_deal uuid,p_expected_review text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.staking_deals%ROWTYPE;r public.staking_listing_archive_receipts_v1%ROWTYPE;expected jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_actor IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin')
 THEN RAISE EXCEPTION 'staking_archive_forbidden' USING ERRCODE='42501';END IF;
 IF p_deal IS NULL OR p_expected_review IS NULL OR p_expected_review NOT IN('approved','rejected') THEN RAISE EXCEPTION 'staking_archive_invalid_payload';END IF;
 SELECT * INTO d FROM public.staking_deals WHERE id=p_deal;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_archive_not_found';END IF;
 SELECT * INTO r FROM public.staking_listing_archive_receipts_v1 WHERE deal_id=p_deal;
 IF FOUND THEN
  IF r.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'staking_archive_forbidden' USING ERRCODE='42501';END IF;
  IF r.expected_review IS DISTINCT FROM p_expected_review THEN RAISE EXCEPTION 'staking_archive_receipt_conflict';END IF;
  expected:=jsonb_build_object('success',true,'deal_id',p_deal,'status','cancelled','archived',true);
  IF r.response IS DISTINCT FROM expected THEN RAISE EXCEPTION 'staking_archive_read_unverified';END IF;
  IF d.status='cancelled' AND d.cancellation_reason='reviewed_listing_archived' THEN RETURN expected;END IF;
  RETURN jsonb_build_object('success',false,'deal_id',p_deal,'state','needs_attention');
 END IF;
 -- Observation only; not_recorded does not assert eligibility or permission to retry.
 RETURN jsonb_build_object('success',false,'deal_id',p_deal,'state',CASE WHEN d.status='listing' AND d.admin_review_status::text=p_expected_review THEN 'not_recorded' ELSE 'needs_attention' END);
END $$;
REVOKE ALL ON FUNCTION public.get_staking_listing_archive_receipt_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_listing_archive_receipt_v1(uuid,uuid,text) TO service_role;
COMMIT;
