-- CLI candidate20261018185905 ->168. LOCAL ONLY, additive after166/167.
-- Recovery: revoke v2 writer; preserve receipts and payroll/audit history.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.save_payroll_period(uuid,integer,integer,date,date,jsonb,uuid)'::regprocedure)<>'22700d30ffd8fb9e347858ada9ff53c2'
 OR to_regclass('floor_private.payroll_save_receipts_v2') IS NOT NULL
 OR to_regprocedure('public.save_payroll_period_v2(uuid,integer,integer,date,date,jsonb,uuid)') IS NOT NULL
 OR to_regprocedure('public.get_payroll_save_receipt_v2(uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000168') THEN
   RAISE EXCEPTION 'payroll168_catalog_drift_or_collision';END IF;
END $$;
CREATE TABLE floor_private.payroll_save_receipts_v2(
 actor_id uuid NOT NULL,request_id uuid NOT NULL,club_id uuid NOT NULL,
 payload_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE floor_private.payroll_save_receipts_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.payroll_save_receipts_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_payroll_period_v2(
 p_club_id uuid,p_year integer,p_month integer,p_start_date date,p_end_date date,p_payroll_rows jsonb,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();payload_hash text;receipt floor_private.payroll_save_receipts_v2%ROWTYPE;
 period uuid;response jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'payroll_auth_required' USING ERRCODE='42501';END IF;
 IF NOT COALESCE(public._is_payroll_accountant(p_club_id),false) THEN PERFORM public.assert_payroll_actor(p_club_id);END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'payroll_request_required' USING ERRCODE='22023';END IF;
 payload_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
   'club',p_club_id,'year',p_year,'month',p_month,'start',p_start_date,'end',p_end_date,'rows',p_payroll_rows)::text,'UTF8'),'sha256'),'hex');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payroll-save-receipt:'||actor||':'||p_request_id,0));
 SELECT * INTO receipt FROM floor_private.payroll_save_receipts_v2 r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF FOUND THEN
   IF receipt.club_id IS DISTINCT FROM p_club_id OR receipt.payload_hash IS DISTINCT FROM payload_hash THEN
     RAISE EXCEPTION 'payroll_request_payload_conflict' USING ERRCODE='22023';END IF;
   RETURN receipt.response;
 END IF;
 period:=public.save_payroll_period_secure(p_club_id,p_year,p_month,p_start_date,p_end_date,p_payroll_rows);
 response:=pg_catalog.jsonb_build_object('ok',true,'outcome','saved','requestId',p_request_id,
   'periodId',period,'clubId',p_club_id,'year',p_year,'month',p_month,'savedCount',pg_catalog.jsonb_array_length(p_payroll_rows));
 INSERT INTO floor_private.payroll_save_receipts_v2(actor_id,request_id,club_id,payload_hash,response)
 VALUES(actor,p_request_id,p_club_id,payload_hash,response);
 RETURN response;
END $$;
CREATE FUNCTION public.get_payroll_save_receipt_v2(p_request_id uuid,p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();response jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'payroll_auth_required' USING ERRCODE='42501';END IF;
 IF NOT COALESCE(public._is_payroll_accountant(p_club_id),false) THEN PERFORM public.assert_payroll_actor(p_club_id);END IF;
 SELECT r.response INTO response FROM floor_private.payroll_save_receipts_v2 r
   WHERE r.actor_id=actor AND r.request_id=p_request_id AND r.club_id=p_club_id;
 RETURN response;
END $$;
REVOKE ALL ON FUNCTION public.save_payroll_period_v2(uuid,integer,integer,date,date,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_payroll_save_receipt_v2(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_payroll_period_v2(uuid,integer,integer,date,date,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_save_receipt_v2(uuid,uuid) TO authenticated;
COMMIT;
