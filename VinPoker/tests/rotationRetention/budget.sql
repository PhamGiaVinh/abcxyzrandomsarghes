-- Disposable PostgreSQL only. Deterministic slow-work fault injection is NOT
-- physical disk I/O or production throughput evidence. All fixture writes roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='6s';
INSERT INTO public.clubs(id,name) VALUES ('e3000000-0000-4000-8000-000000000001','BUDGET TEST');
INSERT INTO public.game_tables(id,club_id,table_name) VALUES
 ('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','BUDGET');
INSERT INTO public.dealer_rotation_schedule(club_id,table_id,slot_index,planned_relief_at,status)
SELECT 'e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001',0,
 now()-interval '100 days','superseded' FROM generate_series(1,400);
INSERT INTO public.dealer_rotation_schedule(club_id,table_id,slot_index,planned_relief_at,status)
VALUES ('e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001',0,now()-interval '1 year','executing');
CREATE FUNCTION public.rotation_budget_test_delay() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_sleep(0.03); RETURN OLD; END $$;
CREATE TRIGGER rotation_budget_test_delay BEFORE DELETE ON public.dealer_rotation_schedule
 FOR EACH ROW WHEN (OLD.club_id='e3000000-0000-4000-8000-000000000001')
 EXECUTE FUNCTION public.rotation_budget_test_delay();
CREATE TEMP TABLE budget_results(response jsonb,wall_ms numeric);
DO $test$
DECLARE r jsonb; started timestamptz; elapsed numeric;
BEGIN
  started:=clock_timestamp();
  r:=public.cleanup_dealer_rotation_schedule('e3000000-0000-4000-8000-000000000001',5000);
  elapsed:=extract(epoch FROM (clock_timestamp()-started))*1000;
  INSERT INTO budget_results VALUES(r,elapsed);
  IF (r->>'deleted')::int NOT BETWEEN 1 AND 100
    OR (r->>'inspected')::int<>(r->>'deleted')::int
    OR (r->>'batch_cap')::int<>5000 OR NOT (r->>'budget_exhausted')::boolean
    OR elapsed<1900 OR elapsed>5000 THEN
    RAISE EXCEPTION 'slow work did not return committed progress within cooperative budget: % elapsed=%',r,elapsed;
  END IF;
  IF (SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='e3000000-0000-4000-8000-000000000001'
      AND status='superseded')<>400-(r->>'deleted')::int
    OR (SELECT count(*) FROM public.dealer_rotation_schedule WHERE club_id='e3000000-0000-4000-8000-000000000001'
      AND status='executing')<>1 THEN RAISE EXCEPTION 'budget deletion conservation/live preservation failed'; END IF;
  r:=public.cleanup_dealer_rotation_schedule('e3000000-0000-4000-8000-000000000001',1);
  IF (r->>'deleted')::int<>1 OR (r->>'inspected')::int<>1 THEN
    RAISE EXCEPTION 'budget retry failed to resume remaining history'; END IF;
END $test$;
TABLE budget_results;
ROLLBACK;
