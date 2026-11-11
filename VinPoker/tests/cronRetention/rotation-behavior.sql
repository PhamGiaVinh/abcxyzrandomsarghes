\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.clubs(id,name) VALUES('00000000-0000-0000-0000-000000000001','synthetic A'),
 ('00000000-0000-0000-0000-000000000002','synthetic B');
INSERT INTO public.dealer_rotation_schedule(id,club_id,slot_index,status,planned_relief_at)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000001',n,
 CASE n WHEN 1 THEN 'superseded' WHEN 2 THEN 'executed' WHEN 3 THEN 'cancelled'
 WHEN 4 THEN 'no_show' WHEN 5 THEN 'predicted' WHEN 6 THEN 'announced' WHEN 7 THEN 'executing' ELSE 'superseded' END,
 CASE n WHEN 8 THEN now() ELSE now()-interval '100 days' END FROM generate_series(1,8)n;
DO $$DECLARE r jsonb; BEGIN
 r:=public.cleanup_next_dealer_rotation_schedule(2);
 IF (r->>'deleted')::int<>2 OR (r->>'inspected')::int<>2 THEN
   RAISE EXCEPTION 'first rotation page mismatch %',r; END IF;
 r:=public.cleanup_next_dealer_rotation_schedule(5000);
 IF (r->>'deleted')::int<>2 OR (r->>'inspected')::int<>6 OR NOT(r->>'sweep_complete')::boolean
    OR (SELECT count(*) FROM public.dealer_rotation_schedule)<>4 THEN
   RAISE EXCEPTION 'rotation policy mismatch %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM retention_private.rotation_checkpoint
   WHERE total_deleted=4 AND total_inspected=8 AND completed_sweeps=1) THEN
   RAISE EXCEPTION 'rotation committed counters mismatch'; END IF;
 -- Random UUID inserted behind a current cursor must survive until next sweep,
 -- then be picked up; a zero UUID is valid and must not be skipped.
 r:=public.cleanup_next_dealer_rotation_schedule(1);
 INSERT INTO public.dealer_rotation_schedule(id,club_id,status,planned_relief_at)
 VALUES('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000002','superseded',now()-interval '2 days');
 r:=public.cleanup_next_dealer_rotation_schedule(5000);
 IF NOT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='00000000-0000-0000-0000-000000000000') THEN
   RAISE EXCEPTION 'fixed UUID ceiling/cursor skipped a new row unsafely'; END IF;
 r:=public.cleanup_next_dealer_rotation_schedule(5000);
 IF (r->>'deleted')::int<>1 THEN RAISE EXCEPTION 'UUID sweep did not revisit earlier insert %',r; END IF;
END$$;
ROLLBACK;
BEGIN;
INSERT INTO public.clubs(id,name) VALUES('00000000-0000-0000-0000-000000000001','FAILURE TEST');
INSERT INTO public.dealer_rotation_schedule(id,club_id,status,planned_relief_at)
VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','superseded',now()-interval '2 days');
CREATE FUNCTION public.rotation_checkpoint_fail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic rotation worker failure'; END$$;
CREATE TRIGGER rotation_checkpoint_fail BEFORE DELETE ON public.dealer_rotation_schedule
 FOR EACH ROW EXECUTE FUNCTION public.rotation_checkpoint_fail();
DO $$BEGIN
 BEGIN
   PERFORM public.cleanup_next_dealer_rotation_schedule(1);
   RAISE EXCEPTION 'missing worker failure';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'synthetic rotation worker failure' THEN RAISE; END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM retention_private.rotation_checkpoint
      WHERE scan_after IS NULL AND total_deleted=0 AND total_inspected=0)
    OR (SELECT count(*) FROM public.dealer_rotation_schedule)<>1 THEN
   RAISE EXCEPTION 'rotation failure did not roll back source/checkpoint/telemetry'; END IF;
END$$;
DROP TRIGGER rotation_checkpoint_fail ON public.dealer_rotation_schedule;
DO $$BEGIN
 IF (public.cleanup_next_dealer_rotation_schedule(1)->>'deleted')::int<>1 THEN
   RAISE EXCEPTION 'rotation failure retry lost work'; END IF;
END$$;
ROLLBACK;
\echo ROTATION_CHECKPOINT_BEHAVIOR_PASS
