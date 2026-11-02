-- CLI candidate20261019225833, forward slot195 checked local/source. NOT LIVE.
-- Pull progress only: canonical ingest and settlement remain separate/idempotent.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE private.sepay_pull_progress_v1 (
 club_id uuid PRIMARY KEY REFERENCES public.clubs(id),
 account_number text NOT NULL,
 bank_account_id uuid NOT NULL,
 window_from timestamptz NOT NULL,
 window_to timestamptz NOT NULL,
 next_page integer NOT NULL CHECK(next_page>=1),
 completed boolean NOT NULL DEFAULT false,
 lease_token uuid,
 lease_until timestamptz,
 CHECK(window_from<=window_to),
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
ALTER TABLE private.sepay_pull_progress_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.sepay_pull_progress_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sepay_claim_pull_v1(p_club_id uuid,p_bank_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.club_payment_config%ROWTYPE; state private.sepay_pull_progress_v1%ROWTYPE;
 stamp timestamptz:=date_trunc('second',clock_timestamp()); token uuid;
BEGIN
 IF coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' OR auth.uid() IS NOT NULL THEN
  RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_club_id IS NULL OR p_bank_account_id IS NULL THEN RAISE EXCEPTION 'invalid_pull_scope'; END IF;
 -- Both operations take config then progress; never invert this lock order.
 SELECT * INTO cfg FROM public.club_payment_config WHERE club_id=p_club_id FOR UPDATE;
 IF NOT FOUND OR NOT cfg.is_active OR cfg.api_token_vault_key IS NULL OR nullif(btrim(cfg.master_account_number),'') IS NULL THEN
  RAISE EXCEPTION 'active_payment_account_required'; END IF;
 INSERT INTO private.sepay_pull_progress_v1(club_id,account_number,bank_account_id,window_from,window_to,next_page)
 VALUES(p_club_id,btrim(cfg.master_account_number),p_bank_account_id,
  coalesce(cfg.last_pull_at-interval '1 hour',stamp-interval '24 hours'),stamp,1) ON CONFLICT(club_id) DO NOTHING;
 SELECT * INTO state FROM private.sepay_pull_progress_v1 WHERE club_id=p_club_id FOR UPDATE;
 IF state.account_number<>btrim(cfg.master_account_number) OR state.bank_account_id<>p_bank_account_id THEN
  RAISE EXCEPTION 'sepay_pull_account_changed'; END IF;
 IF state.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('status','busy'); END IF;
 IF state.completed THEN
  UPDATE private.sepay_pull_progress_v1 SET window_from=cfg.last_pull_at-interval '1 hour',window_to=stamp,next_page=1,completed=false
  WHERE club_id=p_club_id;
 END IF;
 token:=gen_random_uuid();
 UPDATE private.sepay_pull_progress_v1 SET lease_token=token,lease_until=clock_timestamp()+interval '2 minutes'
 WHERE club_id=p_club_id RETURNING * INTO state;
 RETURN jsonb_build_object('status','claimed','lease_token',token,'window_from',state.window_from,'window_to',state.window_to,'next_page',state.next_page);
END $$;

CREATE FUNCTION public.sepay_checkpoint_pull_v1(p_club_id uuid,p_lease_token uuid,p_expected_page integer,p_next_page integer,p_complete boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.club_payment_config%ROWTYPE; state private.sepay_pull_progress_v1%ROWTYPE;
BEGIN
 IF coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' OR auth.uid() IS NOT NULL THEN
  RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_club_id IS NULL OR p_lease_token IS NULL OR p_expected_page IS NULL OR p_next_page IS NULL OR p_complete IS NULL
  OR p_expected_page<1 OR p_next_page<=p_expected_page OR p_next_page::bigint>p_expected_page::bigint+5 THEN
  RAISE EXCEPTION 'invalid_pull_checkpoint'; END IF;
 SELECT * INTO cfg FROM public.club_payment_config WHERE club_id=p_club_id FOR UPDATE;
 IF NOT FOUND OR NOT cfg.is_active OR cfg.api_token_vault_key IS NULL THEN RAISE EXCEPTION 'active_payment_account_required'; END IF;
 SELECT * INTO state FROM private.sepay_pull_progress_v1 WHERE club_id=p_club_id FOR UPDATE;
 IF NOT FOUND OR state.lease_token IS DISTINCT FROM p_lease_token OR state.lease_until<=clock_timestamp()
  OR state.next_page<>p_expected_page OR state.completed THEN RAISE EXCEPTION 'stale_pull_lease'; END IF;
 IF state.account_number IS DISTINCT FROM btrim(cfg.master_account_number) THEN RAISE EXCEPTION 'sepay_pull_account_changed'; END IF;
 UPDATE private.sepay_pull_progress_v1 SET next_page=p_next_page,completed=p_complete,lease_token=NULL,lease_until=NULL WHERE club_id=p_club_id;
 IF p_complete THEN
  UPDATE public.club_payment_config SET last_pull_at=state.window_to WHERE club_id=p_club_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'complete',p_complete,'next_page',p_next_page);
END $$;
REVOKE ALL ON FUNCTION public.sepay_claim_pull_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sepay_checkpoint_pull_v1(uuid,uuid,integer,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sepay_claim_pull_v1(uuid,uuid),public.sepay_checkpoint_pull_v1(uuid,uuid,integer,integer,boolean) TO service_role;
COMMIT;
-- Recovery: leave unfinished progress intact; old worker must not advance its
-- watermark. Drop these new functions/table only after disabling their caller.
