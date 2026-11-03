-- PENDING LOCAL. Additive readback for PT finalization/lost-response recovery.
-- Recovery: revoke this reader; preserve every statement and request.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.get_part_time_payroll_statement_status_v1(uuid,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public._assert_dealer_payroll_statement_actor(uuid)') IS NULL THEN
 RAISE EXCEPTION 'pt_statement_reader_collision_or_dependency';END IF;
END $$;
CREATE FUNCTION public.get_part_time_payroll_statement_status_v1(
 p_club_id uuid,p_dealer_id uuid,p_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.dealer_payroll_statements%ROWTYPE;
BEGIN
 IF p_club_id IS NULL OR p_dealer_id IS NULL THEN
 RAISE EXCEPTION 'PAYROLL_STATEMENT_INVALID_REQUEST' USING ERRCODE='22023';END IF;
 PERFORM public._assert_dealer_payroll_statement_actor(p_club_id);
 IF NOT EXISTS(SELECT 1 FROM public.dealers d WHERE d.id=p_dealer_id AND d.club_id=p_club_id) THEN
 RAISE EXCEPTION 'PAYROLL_STATEMENT_DEALER_NOT_FOUND' USING ERRCODE='P0002';END IF;
 SELECT * INTO s FROM public.dealer_payroll_statements x
 WHERE x.club_id=p_club_id AND x.dealer_id=p_dealer_id AND x.statement_kind='part_time_settlement'
 AND ((p_request_id IS NOT NULL AND x.request_id=p_request_id)
 OR (p_request_id IS NULL AND x.state NOT IN('voided','replaced')))
 ORDER BY x.finalized_at DESC,x.id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN pg_catalog.jsonb_build_object('statement_id',s.id,'request_id',s.request_id,
 'club_id',s.club_id,'dealer_id',s.dealer_id,'state',s.state,'net_amount_vnd',s.net_amount_vnd,
 'finalized_at',s.finalized_at,'payment_id',s.pt_wage_payment_id,'statement_hash',s.statement_hash);
END $$;
REVOKE ALL ON FUNCTION public.get_part_time_payroll_statement_status_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_part_time_payroll_statement_status_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
