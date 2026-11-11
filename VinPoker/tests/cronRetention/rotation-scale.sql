\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.clubs(id,name) VALUES('e1000000-0000-4000-8000-000000000001','SYNTHETIC');
INSERT INTO public.dealer_rotation_schedule(id,club_id,status,planned_relief_at)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'e1000000-0000-4000-8000-000000000001',
 CASE WHEN n%2=0 THEN 'superseded' ELSE 'executing' END,now()-interval '100 days'
FROM generate_series(1,1000000)n;
ANALYZE public.dealer_rotation_schedule;
LOAD 'auto_explain';
SET LOCAL auto_explain.log_min_duration=0;
SET LOCAL auto_explain.log_analyze=on;
SET LOCAL auto_explain.log_nested_statements=on;
SET LOCAL auto_explain.log_format=json;
SET LOCAL auto_explain.log_level=notice;
SELECT public.cleanup_next_dealer_rotation_schedule(2);
SET LOCAL auto_explain.log_min_duration=-1;
DO $$DECLARE r jsonb; BEGIN
 FOR i IN 1..2 LOOP
   PERFORM set_config('plan_cache_mode',CASE WHEN i=1 THEN 'force_custom_plan' ELSE 'force_generic_plan' END,true);
   r:=public.cleanup_next_dealer_rotation_schedule(5000);
   IF (r->>'inspected')::int NOT BETWEEN 1 AND 5000
     OR (r->>'deleted')::int NOT BETWEEN 1 AND (r->>'inspected')::int
     OR NOT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='00000000-0000-0000-0000-000000000001') THEN
     RAISE EXCEPTION 'rotation million-row bounds/live row mismatch %',r; END IF;
   RAISE NOTICE 'ROTATION_CHECKPOINT_MILLION_ROW % %',current_setting('plan_cache_mode'),r;
 END LOOP;
END$$;
ROLLBACK;
BEGIN;
INSERT INTO public.clubs(id,name) VALUES('e1000000-0000-4000-8000-000000000001','SLOW SYNTHETIC');
INSERT INTO public.dealer_rotation_schedule(club_id,status,planned_relief_at)
SELECT 'e1000000-0000-4000-8000-000000000001','superseded',now()-interval '100 days' FROM generate_series(1,400);
CREATE FUNCTION public.rotation_checkpoint_slow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_sleep(0.03); RETURN OLD; END$$;
CREATE TRIGGER rotation_checkpoint_slow BEFORE DELETE ON public.dealer_rotation_schedule
 FOR EACH ROW EXECUTE FUNCTION public.rotation_checkpoint_slow();
DO $$DECLARE r jsonb; BEGIN
 r:=public.cleanup_next_dealer_rotation_schedule(5000);
 IF (r->>'deleted')::int NOT BETWEEN 1 AND 100 OR (r->>'elapsed_ms')::numeric NOT BETWEEN 1900 AND 5000 THEN
   RAISE EXCEPTION 'rotation total work budget ineffective %',r; END IF;
 RAISE NOTICE 'ROTATION_CHECKPOINT_SLOW_WORK %',r;
END$$;
ROLLBACK;
\echo ROTATION_CHECKPOINT_SCALE_BUDGET_PASS
