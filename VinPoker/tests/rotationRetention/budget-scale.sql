\set ON_ERROR_STOP on
LOAD 'auto_explain';
SET auto_explain.log_min_duration=0;
SET auto_explain.log_analyze=on;
SET auto_explain.log_buffers=on;
SET auto_explain.log_nested_statements=on;
SET auto_explain.log_format='json';
SET statement_timeout='10s';
CREATE TEMP TABLE budget_scale_results(plan_mode text,response jsonb);
DO $test$
DECLARE r jsonb; mode text;
BEGIN
  FOREACH mode IN ARRAY ARRAY['force_custom_plan','force_generic_plan'] LOOP
    PERFORM set_config('plan_cache_mode',mode,true);
    r:=public.cleanup_dealer_rotation_schedule('e1000000-0000-4000-8000-000000000001',999999);
    INSERT INTO budget_scale_results VALUES(mode,r);
    IF (r->>'deleted')::int NOT BETWEEN 1 AND 5000
      OR (r->>'inspected')::int NOT BETWEEN (r->>'deleted')::int AND 5000
      OR (r->>'batch_cap')::int<>5000 THEN RAISE EXCEPTION 'large budget/cap failed mode=%: %',mode,r; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.dealer_rotation_schedule WHERE status IN('predicted','announced','executing'))<>3
    OR (SELECT count(*) FROM public.dealer_rotation_schedule WHERE planned_relief_at>now()-interval '1 hour')<>2 THEN
    RAISE EXCEPTION 'large budget removed live/recent history'; END IF;
  IF has_function_privilege('anon','public.cleanup_dealer_rotation_schedule(uuid,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.cleanup_dealer_rotation_schedule(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'budget exposed to browser'; END IF;
END $test$;
TABLE budget_scale_results;
SELECT 'isolated synthetic width; not production disk throughput' AS scope,
 pg_relation_size('public.dealer_rotation_schedule') AS heap_bytes,
 pg_indexes_size('public.dealer_rotation_schedule') AS index_bytes;
