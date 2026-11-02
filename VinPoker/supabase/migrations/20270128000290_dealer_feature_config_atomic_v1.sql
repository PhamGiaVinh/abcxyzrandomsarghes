-- CLI generated20261025044137; reserved290 after source289/catalog inspection.
-- LOCAL candidate. DB -> compatible frontend is required; old setters become internal.
-- Recovery: revoke new writer EXECUTE, retain receipts/audit. Do not restore the
-- two-call browser writer or delete committed configuration history.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF to_regclass('private.dealer_feature_config_receipts_v1') IS NOT NULL
  OR to_regprocedure('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)') IS NOT NULL
  OR to_regprocedure('public.get_table_dealer_profile_receipt_v1(uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'dealer_feature290_catalog_collision'; END IF;
 IF md5(pg_get_functiondef('public.set_table_dealer_mode(uuid,text,boolean,boolean)'::regprocedure))<>'4c18339e2bfa8eec66f734bcaf6881fc'
  OR md5(pg_get_functiondef('public.set_table_dealer_pool(uuid,jsonb)'::regprocedure))<>'510996835d4197553f1b14a7694f4ba0' THEN
  RAISE EXCEPTION 'dealer_feature290_dependency_drift'; END IF;
END $$;

CREATE TABLE private.dealer_feature_config_receipts_v1(
 actor_id uuid NOT NULL,
 request_id uuid NOT NULL,
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 table_id uuid NOT NULL REFERENCES public.game_tables(id),
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.dealer_feature_config_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dealer_feature_config_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_table_dealer_profile_v1(
 p_club_id uuid,p_table_id uuid,p_table_mode text,p_is_final boolean,
 p_allow_override boolean,p_members jsonb,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE actor uuid:=auth.uid(); club uuid; payload jsonb; receipt record; result jsonb; mode_result jsonb; pool_result jsonb;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'DEALER_PROFILE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_club_id IS NULL OR p_table_id IS NULL
  OR p_table_mode IS NULL OR p_table_mode NOT IN('normal','feature')
  OR p_is_final IS NULL OR p_allow_override IS NULL
  OR p_members IS NULL OR jsonb_typeof(p_members)<>'array' THEN
  RAISE EXCEPTION 'DEALER_PROFILE_INVALID_PAYLOAD' USING ERRCODE='22023'; END IF;
 -- Authorization sources remain locked until commit; no client-supplied actor.
 PERFORM 1 FROM public.clubs c WHERE c.id=p_club_id FOR SHARE;
 PERFORM 1 FROM public.club_dealer_controls c WHERE c.club_id=p_club_id AND c.user_id=actor FOR SHARE;
 PERFORM 1 FROM public.user_roles r WHERE r.user_id=actor AND r.role='super_admin'::public.app_role FOR SHARE;
 IF NOT public._dealer_feature_can_manage(actor,p_club_id) THEN
  RAISE EXCEPTION 'DEALER_PROFILE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('club_id',p_club_id,'table_id',p_table_id,'table_mode',p_table_mode,
  'is_final',p_is_final,'allow_override',p_allow_override,'members',p_members);
 -- Same actor/key is serialized across different tables/clubs too.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dealer-profile:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO receipt FROM private.dealer_feature_config_receipts_v1 r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'DEALER_PROFILE_REQUEST_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN receipt.result;
 END IF;
 SELECT g.club_id INTO club FROM public.game_tables g WHERE g.id=p_table_id FOR UPDATE;
 IF club IS DISTINCT FROM p_club_id THEN RAISE EXCEPTION 'DEALER_PROFILE_TABLE_SCOPE_MISMATCH' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_members) e WHERE jsonb_typeof(e)<>'object'
   OR jsonb_typeof(e->'dealer_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(e->'priority') IS DISTINCT FROM 'number'
   OR jsonb_typeof(e->'is_primary') IS DISTINCT FROM 'boolean') THEN
  RAISE EXCEPTION 'DEALER_PROFILE_INVALID_MEMBERS' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*)<>count(DISTINCT (e->>'dealer_id')::uuid) FROM jsonb_array_elements(p_members)e) THEN
  RAISE EXCEPTION 'DEALER_PROFILE_DUPLICATE_MEMBER' USING ERRCODE='22023'; END IF;
 -- Prevent a same-ID dealer moving clubs while this configuration commits.
 PERFORM 1 FROM public.dealers d WHERE d.id IN(SELECT (e->>'dealer_id')::uuid FROM jsonb_array_elements(p_members)e) ORDER BY d.id FOR SHARE;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_members)e LEFT JOIN public.dealers d ON d.id=(e->>'dealer_id')::uuid
   WHERE d.id IS NULL OR d.club_id IS DISTINCT FROM club) THEN
  RAISE EXCEPTION 'DEALER_PROFILE_MEMBER_SCOPE_MISMATCH' USING ERRCODE='42501'; END IF;
 -- Both existing audited operations now belong to ONE statement/transaction.
 mode_result:=public.set_table_dealer_mode(p_table_id,p_table_mode,p_is_final,p_allow_override);
 pool_result:=public.set_table_dealer_pool(p_table_id,p_members);
 IF mode_result->>'table_id' IS DISTINCT FROM p_table_id::text
  OR pool_result->>'table_id' IS DISTINCT FROM p_table_id::text
  OR (pool_result->>'member_count')::integer IS DISTINCT FROM jsonb_array_length(p_members) THEN
  RAISE EXCEPTION 'DEALER_PROFILE_WRITE_RECEIPT_INVALID' USING ERRCODE='23514'; END IF;
 result:=jsonb_build_object('status','saved','request_id',p_request_id,'club_id',club,'table_id',p_table_id,
  'profile',payload-'club_id'-'table_id');
 INSERT INTO private.dealer_feature_config_receipts_v1(actor_id,request_id,club_id,table_id,payload,result)
 VALUES(actor,p_request_id,club,p_table_id,payload,result);
 RETURN result;
END $$;

CREATE FUNCTION public.get_table_dealer_profile_receipt_v1(p_club_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$ DECLARE actor uuid:=auth.uid(); result jsonb; BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
  OR p_club_id IS NULL OR p_request_id IS NULL
  OR NOT public._dealer_feature_can_manage(actor,p_club_id) THEN
  RAISE EXCEPTION 'DEALER_PROFILE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT r.result INTO result FROM private.dealer_feature_config_receipts_v1 r
 WHERE r.actor_id=actor AND r.request_id=p_request_id AND r.club_id=p_club_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','receipt_not_found'); END IF;
 RETURN jsonb_build_object('status','receipt_found','result',result);
END $$;

REVOKE ALL ON FUNCTION public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_table_dealer_profile_receipt_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_table_dealer_profile_receipt_v1(uuid,uuid) TO authenticated;
-- Only the canonical owner-executed wrapper may call these audited internals.
REVOKE EXECUTE ON FUNCTION public.set_table_dealer_mode(uuid,text,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.set_table_dealer_pool(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
