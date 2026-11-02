-- CLI generated20261024072735; forward277 reserved after276, exact catalog checked.
-- Technical fences only: existing manual money/rounding validation remains private.
-- Recovery: hold new caller; retain receipts/runs/prizes. Any restoration of the
-- legacy writer is a separately reviewed forward migration, never ledger deletion.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $pre$
DECLARE definition text;
BEGIN
 IF current_user<>'postgres'
  OR to_regclass('floor_private.payout_manual_edit_receipts_v1') IS NOT NULL
  OR to_regprocedure('public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.get_tournament_payout_edit_receipt_v1(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.get_tournament_payout_edit_receipt_v1(uuid,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.cancel_tournament_payout_edit_v1(uuid,jsonb,text,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.cancel_tournament_payout_edit_v1(uuid,jsonb,text,uuid,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('floor_private.save_tournament_prizes_legacy_v2(uuid,jsonb,text)') IS NOT NULL
  OR to_regprocedure('floor_private.payout_manual_edit_actor_v1(uuid)') IS NOT NULL
  OR to_regprocedure('floor_private.payout_manual_edit_intent_v1(uuid,jsonb,text,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'payout277_namespace_or_actor_drift';END IF;
 SELECT pg_get_functiondef('public.save_tournament_prizes_v2(uuid,jsonb,text)'::regprocedure) INTO definition;
 IF md5(replace(definition,chr(13),''))<>'d00da78c8b4e3fd1e6f3431bac98ef5c'
 THEN RAISE EXCEPTION 'payout277_legacy_writer_definition_drift';END IF;
 definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.save_tournament_prizes_v2(',
  'CREATE FUNCTION floor_private.save_tournament_prizes_legacy_v2(');
 EXECUTE definition;
END $pre$;
ALTER FUNCTION floor_private.save_tournament_prizes_legacy_v2(uuid,jsonb,text) SET search_path='';
REVOKE ALL ON FUNCTION floor_private.save_tournament_prizes_legacy_v2(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE floor_private.payout_manual_edit_receipts_v1 (
 actor_id uuid NOT NULL,
 request_id uuid NOT NULL,
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{32}$'),
 intent jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE floor_private.payout_manual_edit_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE floor_private.payout_manual_edit_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION floor_private.payout_manual_edit_actor_v1(p_tournament_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND';END IF;
 IF NOT(public.is_club_owner(actor,club) OR public.is_club_admin(actor,club) OR public.is_club_cashier(actor,club))
 THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION floor_private.payout_manual_edit_actor_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION floor_private.payout_manual_edit_intent_v1(p_tournament_id uuid,p_rows jsonb,p_reason text,p_expected_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_tournament_id IS NULL OR p_expected_run_id IS NULL OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array'
 THEN RAISE EXCEPTION 'PAYOUT_EDIT_INVALID_REQUEST';END IF;
 IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'MANUAL_EDIT_REASON_REQUIRED';END IF;
 RETURN jsonb_build_object('tournament_id',p_tournament_id,'expected_run_id',p_expected_run_id,'rows',p_rows,'reason',btrim(p_reason));
END $$;
REVOKE ALL ON FUNCTION floor_private.payout_manual_edit_intent_v1(uuid,jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_tournament_prizes_v3(
 p_tournament_id uuid,p_rows jsonb,p_reason text,p_expected_run_id uuid,p_request_id uuid,p_expected_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();canonical jsonb;hash text;
 receipt floor_private.payout_manual_edit_receipts_v1%ROWTYPE;
 applied uuid;replacement uuid;legacy jsonb;result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF actor IS DISTINCT FROM p_expected_actor THEN RAISE EXCEPTION 'PAYOUT_EDIT_ACTOR_MISMATCH';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'PAYOUT_EDIT_INVALID_REQUEST';END IF;
 canonical:=floor_private.payout_manual_edit_intent_v1(p_tournament_id,p_rows,p_reason,p_expected_run_id);
 hash:=md5(canonical::text);
 -- Same ordering for apply/cancel: actor+request advisory → tournament → applied run.
 PERFORM pg_advisory_xact_lock(hashtextextended('payout_manual_edit_v3:'||actor::text||':'||p_request_id::text,0));
 PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;
 PERFORM floor_private.payout_manual_edit_actor_v1(p_tournament_id);
 SELECT * INTO receipt FROM floor_private.payout_manual_edit_receipts_v1 r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt.tournament_id<>p_tournament_id OR receipt.request_hash<>hash OR receipt.intent<>canonical
  THEN RAISE EXCEPTION 'PAYOUT_EDIT_REQUEST_CONFLICT';END IF;
  RETURN receipt.result;
 END IF;
 SELECT r.id INTO applied FROM public.tournament_payout_runs r
 WHERE r.tournament_id=p_tournament_id AND r.status='applied' FOR UPDATE;
 IF applied IS DISTINCT FROM p_expected_run_id THEN RAISE EXCEPTION 'PAYOUT_EDIT_STALE_RUN';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_prize_payments p WHERE p.tournament_id=p_tournament_id)
 THEN RAISE EXCEPTION 'PAYOUT_EDIT_PAYMENT_DEPENDENCY';END IF;
 legacy:=floor_private.save_tournament_prizes_legacy_v2(p_tournament_id,p_rows,btrim(p_reason));
 IF legacy->>'status' IS DISTINCT FROM 'saved' THEN RAISE EXCEPTION 'PAYOUT_EDIT_UNVERIFIED_RESULT';END IF;
 SELECT r.id INTO STRICT replacement FROM public.tournament_payout_runs r
 WHERE r.tournament_id=p_tournament_id AND r.status='applied' AND r.supersedes_run_id=applied AND r.source='manual_edit';
 result:=jsonb_build_object('status','saved','actor_id',actor,'tournament_id',p_tournament_id,'request_id',p_request_id,
  'previous_run_id',applied,'run_id',replacement,'itm_places',(legacy->>'itm_places')::integer);
 INSERT INTO floor_private.payout_manual_edit_receipts_v1(actor_id,request_id,tournament_id,request_hash,intent,result)
 VALUES(actor,p_request_id,p_tournament_id,hash,canonical,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.get_tournament_payout_edit_receipt_v1(p_tournament_id uuid,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;receipt floor_private.payout_manual_edit_receipts_v1%ROWTYPE;
BEGIN
 actor:=floor_private.payout_manual_edit_actor_v1(p_tournament_id);
 IF actor IS DISTINCT FROM p_expected_actor THEN RAISE EXCEPTION 'PAYOUT_EDIT_ACTOR_MISMATCH';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'PAYOUT_EDIT_INVALID_REQUEST';END IF;
 SELECT * INTO receipt FROM floor_private.payout_manual_edit_receipts_v1 r
 WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','actor_id',actor,'tournament_id',p_tournament_id,'request_id',p_request_id);END IF;
 IF receipt.tournament_id<>p_tournament_id THEN RAISE EXCEPTION 'PAYOUT_EDIT_REQUEST_CONFLICT';END IF;
 RETURN jsonb_build_object('status','found','actor_id',actor,'tournament_id',p_tournament_id,'request_id',p_request_id,'intent',receipt.intent,'result',receipt.result);
END $$;
REVOKE ALL ON FUNCTION public.get_tournament_payout_edit_receipt_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_payout_edit_receipt_v1(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.cancel_tournament_payout_edit_v1(
 p_tournament_id uuid,p_rows jsonb,p_reason text,p_expected_run_id uuid,p_request_id uuid,p_expected_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();canonical jsonb;hash text;
 receipt floor_private.payout_manual_edit_receipts_v1%ROWTYPE;result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF actor IS DISTINCT FROM p_expected_actor THEN RAISE EXCEPTION 'PAYOUT_EDIT_ACTOR_MISMATCH';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'PAYOUT_EDIT_INVALID_REQUEST';END IF;
 canonical:=floor_private.payout_manual_edit_intent_v1(p_tournament_id,p_rows,p_reason,p_expected_run_id);
 hash:=md5(canonical::text);
 PERFORM pg_advisory_xact_lock(hashtextextended('payout_manual_edit_v3:'||actor::text||':'||p_request_id::text,0));
 PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;
 PERFORM floor_private.payout_manual_edit_actor_v1(p_tournament_id);
 SELECT * INTO receipt FROM floor_private.payout_manual_edit_receipts_v1 r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt.tournament_id<>p_tournament_id OR receipt.request_hash<>hash OR receipt.intent<>canonical
  THEN RAISE EXCEPTION 'PAYOUT_EDIT_REQUEST_CONFLICT';END IF;
  RETURN receipt.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_payout_runs r WHERE r.id=p_expected_run_id AND r.tournament_id=p_tournament_id)
 THEN RAISE EXCEPTION 'PAYOUT_EDIT_STALE_RUN';END IF;
 result:=jsonb_build_object('status','cancelled','actor_id',actor,'tournament_id',p_tournament_id,'request_id',p_request_id,'previous_run_id',p_expected_run_id);
 INSERT INTO floor_private.payout_manual_edit_receipts_v1(actor_id,request_id,tournament_id,request_hash,intent,result)
 VALUES(actor,p_request_id,p_tournament_id,hash,canonical,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cancel_tournament_payout_edit_v1(uuid,jsonb,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_tournament_payout_edit_v1(uuid,jsonb,text,uuid,uuid,uuid) TO authenticated;

-- The old shape has no CAS/key and must not remain a browser bypass.
CREATE OR REPLACE FUNCTION public.save_tournament_prizes_v2(p_tournament_id uuid,p_rows jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'PAYOUT_EDIT_REQUEST_CONTEXT_REQUIRED';END $$;
REVOKE ALL ON FUNCTION public.save_tournament_prizes_v2(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_tournament_prizes_v2(uuid,jsonb,text) TO authenticated;

DO $post$
DECLARE signature text;
BEGIN
 FOR signature IN SELECT unnest(ARRAY['public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid,uuid)',
  'public.get_tournament_payout_edit_receipt_v1(uuid,uuid,uuid)','public.cancel_tournament_payout_edit_v1(uuid,jsonb,text,uuid,uuid,uuid)']) LOOP
  IF has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('service_role',signature,'EXECUTE')
   OR NOT has_function_privilege('authenticated',signature,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(signature) AND prosecdef AND proconfig=ARRAY['search_path=""'])
  THEN RAISE EXCEPTION 'payout277_public_acl_or_path_drift: %',signature;END IF;
 END LOOP;
 IF has_table_privilege('authenticated','floor_private.payout_manual_edit_receipts_v1','SELECT,INSERT,UPDATE,DELETE')
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='floor_private.payout_manual_edit_receipts_v1'::regclass AND relrowsecurity)
 THEN RAISE EXCEPTION 'payout277_receipt_boundary_drift';END IF;
END $post$;
COMMIT;
