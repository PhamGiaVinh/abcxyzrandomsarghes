\set ON_ERROR_STOP on
INSERT INTO public.clubs(id,name) VALUES
 ('e1000000-0000-4000-8000-000000000001','RETENTION SCALE'),
 ('e1000000-0000-4000-8000-000000000002','OTHER TENANT');
INSERT INTO public.game_tables(id,club_id,table_name) VALUES
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','SCALE'),
 ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','OTHER');
INSERT INTO public.dealer_rotation_schedule(club_id,table_id,slot_index,planned_relief_at,status)
SELECT 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',0,
 now()-interval '100 days'+make_interval(secs=>g%86400),
 (ARRAY['superseded','executed','cancelled','no_show'])[1+g%4]
FROM generate_series(1,1000000) g;
INSERT INTO public.dealer_rotation_schedule(club_id,table_id,slot_index,planned_relief_at,status) VALUES
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',0,now()-interval '1 year','predicted'),
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',1,now()-interval '1 year','announced'),
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',2,now()-interval '1 year','executing'),
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',3,now(),'superseded'),
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',4,now(),'executed'),
 ('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002',0,now()-interval '200 days','cancelled');
ANALYZE public.dealer_rotation_schedule;
ANALYZE public.clubs;

LOAD 'auto_explain';
SET auto_explain.log_min_duration=0;
SET auto_explain.log_analyze=on;
SET auto_explain.log_buffers=on;
SET auto_explain.log_nested_statements=on;
SET auto_explain.log_format='json';
SET statement_timeout='10s';
DO $test$
DECLARE r jsonb;
BEGIN
  IF has_function_privilege('anon','public.cleanup_dealer_rotation_schedule(uuid,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.cleanup_next_dealer_rotation_schedule(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'retention exposed to browser';
  END IF;
  r:=public.cleanup_dealer_rotation_schedule('e1000000-0000-4000-8000-000000000001',999999);
  IF (r->>'deleted')::integer<>5000 OR (r->>'batch_cap')::integer<>5000 THEN
    RAISE EXCEPTION 'large batch cap differs: %',r;
  END IF;
  r:=public.cleanup_dealer_rotation_schedule('e1000000-0000-4000-8000-000000000001',-1);
  IF (r->>'deleted')::integer<>1 OR (r->>'batch_cap')::integer<>1 THEN
    RAISE EXCEPTION 'negative batch cap differs';
  END IF;
  IF (SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='e1000000-0000-4000-8000-000000000002')<>1 THEN
    RAISE EXCEPTION 'cross-tenant deletion';
  END IF;
  r:=public.cleanup_next_dealer_rotation_schedule(5000);
  IF r->>'club_id'<>'e1000000-0000-4000-8000-000000000002' OR (r->>'deleted')::integer<>1 THEN
    RAISE EXCEPTION 'dispatcher does not select oldest eligible club';
  END IF;
  r:=public.cleanup_next_dealer_rotation_schedule(5000);
  IF (r->>'deleted')::integer<>5000 THEN RAISE EXCEPTION 'dispatcher retry made no progress'; END IF;
  IF (SELECT count(*) FROM public.dealer_rotation_schedule WHERE status IN('predicted','announced','executing'))<>3
    OR (SELECT count(*) FROM public.dealer_rotation_schedule WHERE planned_relief_at>now()-interval '1 hour')<>2 THEN
    RAISE EXCEPTION 'live/recent schedule removed';
  END IF;
END $test$;
