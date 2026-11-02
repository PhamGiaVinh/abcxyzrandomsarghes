BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT to_regprocedure('public.get_dealer_scores_v1(uuid)') IS NOT NULL,'dealer score read RPC absent';
 ASSERT NOT has_function_privilege('anon','public.get_dealer_scores_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_dealer_scores_v1(uuid)','EXECUTE');
END $$;
-- Existing exact TEST owner/club, no seed or financial mutation.
SELECT set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.get_dealer_scores_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760')),'exact empty TEST club changed';
 BEGIN PERFORM public.get_dealer_scores_v1('9ef80c7a-cb97-4acc-b81c-5bf34d49317f');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 ASSERT denied,'owner read a different club';
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 denied:=false;
 BEGIN PERFORM public.get_dealer_scores_v1('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 ASSERT denied,'outsider read TEST score roster';
END $$;
RESET ROLE;
-- Compare nonempty canonical TEST roster with the exact historical formula.
CREATE TEMP TABLE expected_scores190 AS
SELECT d.id AS dealer_id,d.full_name::text,d.tier::text,d.club_id,d.employment_type::text,
 coalesce(round(sum(m.total_worked_minutes)/60.0,1),0) AS total_hours,
 coalesce(sum(m.total_assignments),0)::bigint AS total_swings,
 coalesce(round(sum(m.total_worked_minutes)/60.0,1),0)*1.0+coalesce(sum(m.total_assignments),0)*0.5
 +CASE d.tier WHEN 'A' THEN 20 WHEN 'B' THEN 10 ELSE 0 END AS score
FROM public.dealers d
LEFT JOIN public.dealer_attendance a ON a.dealer_id=d.id AND a.shift_date>=CURRENT_DATE-30
LEFT JOIN public.dealer_shift_metrics m ON m.attendance_id=a.id
WHERE d.club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f'
GROUP BY d.id,d.full_name,d.tier,d.club_id,d.employment_type;
GRANT SELECT ON pg_temp.expected_scores190 TO authenticated;
SELECT set_config('request.jwt.claim.sub',owner_id::text,true),
 set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,true)
FROM public.clubs WHERE id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f';
SET LOCAL ROLE authenticated;
DO $$ DECLARE actual jsonb;expected jsonb;BEGIN
 SELECT jsonb_agg(to_jsonb(r) ORDER BY r.dealer_id) INTO actual FROM public.get_dealer_scores_v1('9ef80c7a-cb97-4acc-b81c-5bf34d49317f') r;
 SELECT jsonb_agg(to_jsonb(r) ORDER BY r.dealer_id) INTO expected FROM pg_temp.expected_scores190 r;
 ASSERT jsonb_array_length(expected)>0,'nonempty TEST oracle unavailable';
 ASSERT actual=expected,'score formula or roster changed';
 ASSERT NOT has_table_privilege('authenticated','public.dealer_shift_metrics','SELECT'),'read RPC broadened metrics grant';
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{}',true);
 BEGIN PERFORM public.get_dealer_scores_v1('9ef80c7a-cb97-4acc-b81c-5bf34d49317f');
 RAISE EXCEPTION 'missing actor allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
\echo DEALER_SCORE190_NONEMPTY_FORMULA_EMPTY_SCOPE_OUTSIDER_ACL_ROLLBACK_PASS
