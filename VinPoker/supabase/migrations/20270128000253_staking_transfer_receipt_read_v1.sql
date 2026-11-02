-- CLI candidate20261023150233 -> forward slot253. LOCAL candidate, NOT LIVE.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.get_staking_purchase_transfer_v1(uuid)') IS NOT NULL
 OR to_regclass('public.staking_purchase_receipts_v1') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000253')
 THEN RAISE EXCEPTION 'staking253_catalog_drift';END IF;
END $$;
CREATE FUNCTION public.get_staking_purchase_transfer_v1(p_purchase uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); p public.staking_purchases%ROWTYPE; r public.staking_purchase_receipts_v1%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'staking_transfer_auth_required' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM public.staking_purchases WHERE id=p_purchase AND backer_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'staking_transfer_denied' USING ERRCODE='42501';END IF;
 IF p.status<>'committed' THEN RETURN jsonb_build_object('state','closed','purchase_id',p.id,'deal_id',p.deal_id);END IF;
 SELECT * INTO r FROM public.staking_purchase_receipts_v1 WHERE purchase_id=p.id AND actor_id=actor AND deal_id=p.deal_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','needs_attention','reason','receipt_bank_unproven','purchase_id',p.id,'deal_id',p.deal_id);END IF;
 IF r.response->>'purchase_id' IS DISTINCT FROM p.id::text
 OR (r.response->>'amount_vnd')::numeric IS DISTINCT FROM p.amount_vnd
 OR r.response->>'reference_code' IS DISTINCT FROM p.reference_code
 OR nullif(r.response->>'bank_name','') IS NULL OR nullif(r.response->>'account_number','') IS NULL
 OR nullif(r.response->>'account_holder','') IS NULL OR p.committed_at IS NULL
 THEN RETURN jsonb_build_object('state','needs_attention','reason','receipt_snapshot_mismatch','purchase_id',p.id,'deal_id',p.deal_id);END IF;
 RETURN jsonb_build_object('state','verified','purchase_id',p.id,'deal_id',p.deal_id,
 'committed_at',p.committed_at,'amount_vnd',p.amount_vnd,'reference_code',p.reference_code,
 'bank',jsonb_build_object('bank_name',r.response->>'bank_name','account_number',r.response->>'account_number',
 'account_holder',r.response->>'account_holder','qr_code_url',r.response->>'qr_code_url','notes',NULL));
END $$;
REVOKE ALL ON FUNCTION public.get_staking_purchase_transfer_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_staking_purchase_transfer_v1(uuid) TO authenticated;
COMMIT;
