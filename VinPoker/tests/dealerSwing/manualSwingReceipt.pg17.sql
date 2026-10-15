-- Appended to the existing transactional mass-open fixture before scale40.
CREATE TEMP TABLE swing100_context AS SELECT id,table_id,table_session_id,version
 FROM public.dealer_assignments
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND released_at IS NULL;
GRANT SELECT ON swing100_context TO authenticated;
CREATE TEMP TABLE swing100_result(value jsonb);
GRANT SELECT,INSERT ON swing100_result TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims='{"sub":"e1800000-0000-4000-8000-000000000001","role":"authenticated"}';
INSERT INTO swing100_result SELECT public.operator_perform_swing(table_id,table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000100') FROM swing100_context;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM swing100_result),'canonical operator result exists');
SELECT pg_temp.assert_true((SELECT response=(SELECT value FROM swing100_result) AND completed_at IS NOT NULL
 FROM public.dealer_swing_operator_requests WHERE request_id='e1800000-0000-4000-8000-000000000100'),
 'real writer stores exact response');
CREATE FUNCTION pg_temp.read_swing100(version_delta integer DEFAULT 0, request_key uuid DEFAULT 'e1800000-0000-4000-8000-000000000100', actor uuid DEFAULT 'e1800000-0000-4000-8000-000000000001', club uuid DEFAULT 'e1800000-0000-4000-8000-000000000002')
 RETURNS jsonb LANGUAGE sql AS $$ SELECT public.get_dealer_manual_swing_receipt_v1(actor,club,table_id,table_session_id,id,version+version_delta,request_key) FROM swing100_context $$;
CREATE TEMP TABLE swing100_before AS SELECT md5(jsonb_build_object(
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),
 'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a),
 'requests',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.request_id) FROM public.dealer_swing_operator_requests a))::text) AS fingerprint;
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=pg_temp.read_swing100();
 PERFORM pg_temp.assert_true(result->>'status'='receipt_found' AND result->'response'=(SELECT value FROM swing100_result),'exact historical receipt after real writer');
 PERFORM pg_temp.assert_true(pg_temp.read_swing100(0,'e1800000-0000-4000-8000-000000000101')->>'status'='receipt_not_found','missing is observation not terminal');
 BEGIN PERFORM pg_temp.read_swing100(1); RAISE EXCEPTION 'payload conflict accepted';
 EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'SWING_IDEMPOTENCY_CONFLICT' THEN RAISE; END IF; END;
 BEGIN PERFORM pg_temp.read_swing100(0,NULL); RAISE EXCEPTION 'null key accepted';
 EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM<>'SWING_RECEIPT_INVALID_INTENT' THEN RAISE; END IF; END;
 BEGIN PERFORM pg_temp.read_swing100(0,'e1800000-0000-4000-8000-000000000100','e1800000-0000-4000-8000-000000000099'); RAISE EXCEPTION 'actor mismatch accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM pg_temp.read_swing100(0,'e1800000-0000-4000-8000-000000000100','e1800000-0000-4000-8000-000000000001','e1800000-0000-4000-8000-000000000099'); RAISE EXCEPTION 'cross club accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claims='{"sub":"e1800000-0000-4000-8000-000000000099","role":"authenticated"}';
DO $$ BEGIN
 BEGIN PERFORM pg_temp.read_swing100(0,'e1800000-0000-4000-8000-000000000100','e1800000-0000-4000-8000-000000000099'); RAISE EXCEPTION 'outsider accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT fingerprint=md5(jsonb_build_object(
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),
 'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a),
 'requests',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.request_id) FROM public.dealer_swing_operator_requests a))::text) FROM swing100_before),'all receipt reads and denials have zero write effect');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)','EXECUTE')
 AND has_function_privilege('authenticated','public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)','EXECUTE'),'exact role grants');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.dealer_swing_operator_requests','SELECT'),'no direct receipt table access');
SELECT pg_temp.assert_true((SELECT prosecdef AND provolatile='s' AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""']
 FROM pg_proc WHERE oid='public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)'::regprocedure),'reader metadata');
SELECT 'MANUAL_SWING100_REAL_WRITER_RECEIPT_ACTOR_PAYLOAD_READONLY_PASS';
ROLLBACK;
