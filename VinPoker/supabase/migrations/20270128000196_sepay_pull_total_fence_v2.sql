-- CLI20261019231040, forward196 checked local/source. LOCAL ONLY.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE private.sepay_pull_progress_v1 ADD COLUMN provider_total integer CHECK(provider_total>=0);
-- Retire pre-total in-flight cursors; old tokens may not finish an unverified set.
UPDATE private.sepay_pull_progress_v1 SET next_page=1,lease_token=NULL,lease_until=NULL WHERE NOT completed;

CREATE FUNCTION public.sepay_claim_pull_v2(p_club_id uuid,p_bank_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; total integer;
BEGIN
 result:=public.sepay_claim_pull_v1(p_club_id,p_bank_account_id);
 IF result->>'status'='claimed' THEN
  IF (result->>'next_page')::integer=1 THEN
   UPDATE private.sepay_pull_progress_v1 SET provider_total=NULL WHERE club_id=p_club_id;
  END IF;
  SELECT provider_total INTO total FROM private.sepay_pull_progress_v1 WHERE club_id=p_club_id;
  result:=result||jsonb_build_object('provider_total',total);
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.sepay_checkpoint_pull_v2(p_club_id uuid,p_lease_token uuid,p_expected_page integer,p_next_page integer,p_complete boolean,p_provider_total integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; state private.sepay_pull_progress_v1%ROWTYPE;
BEGIN
 IF p_provider_total IS NULL OR p_provider_total<0 THEN RAISE EXCEPTION 'invalid_provider_total'; END IF;
 -- v1 enforces caller, current lease, page range, config identity and lock order.
 -- Never advance completed watermark before the provider set is checked.
 result:=public.sepay_checkpoint_pull_v1(p_club_id,p_lease_token,p_expected_page,p_next_page,false);
 SELECT * INTO STRICT state FROM private.sepay_pull_progress_v1 WHERE club_id=p_club_id;
 IF state.provider_total IS NOT NULL AND state.provider_total<>p_provider_total THEN
  UPDATE private.sepay_pull_progress_v1 SET next_page=1,provider_total=NULL WHERE club_id=p_club_id;
  RETURN jsonb_build_object('ok',false,'restart_required',true,'code','provider_total_changed');
 END IF;
 UPDATE private.sepay_pull_progress_v1 SET provider_total=p_provider_total WHERE club_id=p_club_id;
 IF p_complete THEN
  UPDATE private.sepay_pull_progress_v1 SET completed=true WHERE club_id=p_club_id;
  UPDATE public.club_payment_config SET last_pull_at=state.window_to WHERE club_id=p_club_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'complete',p_complete,'next_page',p_next_page);
END $$;
REVOKE ALL ON FUNCTION public.sepay_claim_pull_v2(uuid,uuid),public.sepay_checkpoint_pull_v2(uuid,uuid,integer,integer,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sepay_claim_pull_v2(uuid,uuid),public.sepay_checkpoint_pull_v2(uuid,uuid,integer,integer,boolean,integer) TO service_role;
-- Old workers must fail closed rather than bypass the total-change fence.
REVOKE EXECUTE ON FUNCTION public.sepay_claim_pull_v1(uuid,uuid),public.sepay_checkpoint_pull_v1(uuid,uuid,integer,integer,boolean) FROM service_role;
COMMIT;
-- Rollback: disable consumer first and preserve progress. Do NOT re-grant v1
-- to an active old worker: that restores the known skipped-transaction path.
