-- CLI candidate20261018190259 ->169. LOCAL ONLY, after168.
-- Cancellation fences only an uncommitted request; never reverses payroll.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.save_payroll_period_v2(uuid,integer,integer,date,date,jsonb,uuid)'::regprocedure)<>'2e310a941a29febb5cb42f5b6a99dd02'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_payroll_save_receipt_v2(uuid,uuid)'::regprocedure)<>'fa84e864a2076670475a1f0ab96e909b'
 OR to_regprocedure('public.cancel_unresolved_payroll_save_v2(uuid,uuid,integer,integer)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000169') THEN
   RAISE EXCEPTION 'payroll169_catalog_drift_or_collision';END IF;
END $$;
CREATE FUNCTION public.cancel_unresolved_payroll_save_v2(p_request_id uuid,p_club_id uuid,p_year integer,p_month integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();receipt floor_private.payroll_save_receipts_v2%ROWTYPE;response jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'payroll_auth_required' USING ERRCODE='42501';END IF;
 IF NOT COALESCE(public._is_payroll_accountant(p_club_id),false) THEN PERFORM public.assert_payroll_actor(p_club_id);END IF;
 IF p_request_id IS NULL OR p_year IS NULL OR p_month IS NULL THEN RAISE EXCEPTION 'payroll_cancel_scope_required' USING ERRCODE='22023';END IF;
 PERFORM pg_catalog.make_date(p_year,p_month,1);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payroll-save-receipt:'||actor||':'||p_request_id,0));
 SELECT * INTO receipt FROM floor_private.payroll_save_receipts_v2 r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF FOUND THEN
   IF receipt.club_id IS DISTINCT FROM p_club_id OR (receipt.response->>'year')::integer IS DISTINCT FROM p_year
      OR (receipt.response->>'month')::integer IS DISTINCT FROM p_month THEN
     RAISE EXCEPTION 'payroll_request_payload_conflict' USING ERRCODE='22023';END IF;
   RETURN receipt.response;
 END IF;
 response:=pg_catalog.jsonb_build_object('ok',true,'outcome','cancelled','requestId',p_request_id,
   'periodId',NULL,'clubId',p_club_id,'year',p_year,'month',p_month,'savedCount',0);
 -- A late original save sees a different hash and must reject before any write.
 INSERT INTO floor_private.payroll_save_receipts_v2(actor_id,request_id,club_id,payload_hash,response)
 VALUES(actor,p_request_id,p_club_id,'cancelled',response);
 RETURN response;
END $$;
REVOKE ALL ON FUNCTION public.cancel_unresolved_payroll_save_v2(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_unresolved_payroll_save_v2(uuid,uuid,integer,integer) TO authenticated;
COMMIT;
