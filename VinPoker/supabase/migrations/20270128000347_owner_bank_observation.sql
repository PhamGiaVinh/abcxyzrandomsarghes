-- Candidate only: qualify against current schema before catalog promotion/apply.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
CREATE INDEX owner_bank_observation_scope_created_v1
  ON public.bank_transactions(club_id,created_at DESC,id DESC) WHERE provider='sepay';
CREATE FUNCTION public.get_owner_bank_observation_v1(p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid := auth.uid(); v_rows jsonb;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR NOT public.is_club_owner(v_actor,p_club_id) THEN
    RAISE EXCEPTION 'owner_bank_observation_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb)
  INTO v_rows FROM (
    SELECT bt.id,bt.created_at,pg_catalog.jsonb_build_object(
      'id',bt.id,'createdAt',bt.created_at,'occurredAt',bt.occurred_at,
      'amount',bt.amount,'direction',bt.transfer_type,'status',bt.status,
      'verified',bt.api_verified_at IS NOT NULL) item
    FROM public.bank_transactions bt
    WHERE bt.club_id=p_club_id AND bt.provider='sepay'
    ORDER BY bt.created_at DESC,bt.id DESC LIMIT 50
  ) q;
  RETURN pg_catalog.jsonb_build_object('version','owner-bank-observation-v1',
    'clubId',p_club_id,'asOf',pg_catalog.statement_timestamp(),'rows',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.get_owner_bank_observation_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_owner_bank_observation_v1(uuid) TO authenticated;
COMMIT;
-- Rollback after disabling the owner assistant: drop only this function/index.
-- Never delete or modify bank transactions to roll back observation UI.
