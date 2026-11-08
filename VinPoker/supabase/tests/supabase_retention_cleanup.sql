-- Bounded retention cleanup tests. Disposable database only.
-- Run after 20270103000003_retention_cleanup_functions.sql; all writes roll back.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_value boolean, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_value IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assert_true failed: %', p_label;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated', 'public.cleanup_dealer_rotation_schedule(uuid,int)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated', 'public.cleanup_cron_job_run_details(int)', 'EXECUTE'
  ),
  'cleanup functions remain service-role only'
);

INSERT INTO public.clubs (id, name, region, status)
VALUES ('d1000000-0000-4000-8000-000000000001', 'RETENTION TEST', 'TEST', 'approved');

INSERT INTO public.game_tables (id, club_id, table_name, status)
VALUES ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'RETENTION 1', 'active');

-- 5,001 eligible superseded rows prove the hard batch cap. All may share the
-- same table/slot because the unique slot index covers only live states.
INSERT INTO public.dealer_rotation_schedule (
  club_id, table_id, slot_index, planned_relief_at,
  status, plan_run_id, solver_version
)
SELECT
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  0,
  now() - interval '100 days' - make_interval(secs => g),
  'superseded',
  'd3000000-0000-4000-8000-000000000001',
  'retention-test'
FROM generate_series(1, 5001) AS g;

-- Real-event history older than 90 days is eligible.
INSERT INTO public.dealer_rotation_schedule (
  club_id, table_id, slot_index, planned_relief_at,
  status, plan_run_id, solver_version
)
SELECT
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  4,
  now() - interval '120 days',
  status,
  'd3000000-0000-4000-8000-000000000002',
  'retention-test'
FROM unnest(ARRAY['executed', 'cancelled', 'no_show']) AS status;

-- Live states and a recent superseded row must survive every cleanup batch.
INSERT INTO public.dealer_rotation_schedule (
  club_id, table_id, slot_index, planned_relief_at,
  status, plan_run_id, solver_version
)
VALUES
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 0, now() - interval '1 year', 'predicted',  'd3000000-0000-4000-8000-000000000003', 'retention-test'),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 1, now() - interval '1 year', 'announced',  'd3000000-0000-4000-8000-000000000003', 'retention-test'),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 2, now() - interval '1 year', 'executing',  'd3000000-0000-4000-8000-000000000003', 'retention-test'),
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 3, now(),                    'superseded', 'd3000000-0000-4000-8000-000000000003', 'retention-test');

-- Drain the three oldest terminal statuses first. A bounded implementation may
-- process only one status per invocation; a short batch does not mean no work.
SELECT public.cleanup_dealer_rotation_schedule('d1000000-0000-4000-8000-000000000001',1)
FROM generate_series(1,3);

CREATE TEMP TABLE rotation_cleanup_result AS
SELECT public.cleanup_dealer_rotation_schedule(
  'd1000000-0000-4000-8000-000000000001',
  999999
) AS response;

SELECT pg_temp.assert_true(
  (SELECT (response->>'deleted')::int = 5000
          AND (response->>'batch_cap')::int = 5000
   FROM rotation_cleanup_result),
  'rotation cleanup clamps oversized requests to 5000 rows'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 3
   FROM public.dealer_rotation_schedule
   WHERE club_id = 'd1000000-0000-4000-8000-000000000001'
     AND status IN ('predicted', 'announced', 'executing'))
  AND
  (SELECT count(*) = 1
   FROM public.dealer_rotation_schedule
   WHERE club_id = 'd1000000-0000-4000-8000-000000000001'
     AND status = 'superseded'
     AND planned_relief_at >= now() - interval '24 hours'),
  'rotation cleanup never removes live states or recent superseded rows'
);

-- diagnostic_logs: 5,001 old + one fresh.
INSERT INTO public.diagnostic_logs (
  timestamp, created_at, club_id, diagnostic_type, result
)
SELECT
  now() - interval '8 days' - make_interval(secs => g),
  now() - interval '8 days' - make_interval(secs => g),
  'd1000000-0000-4000-8000-000000000001',
  'retention-test',
  '{}'::jsonb
FROM generate_series(1, 5001) AS g;

INSERT INTO public.diagnostic_logs (
  timestamp, created_at, club_id, diagnostic_type, result
)
VALUES (
  now(), now(), 'd1000000-0000-4000-8000-000000000001', 'retention-fresh', '{}'::jsonb
);

CREATE TEMP TABLE diagnostic_cleanup_result AS
SELECT public.cleanup_diagnostic_logs(999999) AS response;

SELECT pg_temp.assert_true(
  (SELECT (response->>'deleted')::int = 5000
          AND (response->>'batch_cap')::int = 5000
   FROM diagnostic_cleanup_result)
  AND
  (SELECT count(*) = 1 FROM public.diagnostic_logs
   WHERE diagnostic_type = 'retention-fresh'),
  'diagnostic cleanup is capped and preserves fresh logs'
);

-- cron_metrics: cleanup is isolated to one cron_name.
INSERT INTO public.cron_metrics (
  cron_name, duration_ms, status, executed_at, created_at
)
SELECT
  'retention-old', 1, 'success',
  now() - interval '31 days' - make_interval(secs => g),
  now() - interval '31 days' - make_interval(secs => g)
FROM generate_series(1, 5001) AS g;

INSERT INTO public.cron_metrics (
  cron_name, duration_ms, status, executed_at, created_at
)
VALUES
  ('retention-fresh', 1, 'success', now(), now()),
  ('retention-other', 1, 'success', now() - interval '31 days', now() - interval '31 days');

CREATE TEMP TABLE cron_metrics_cleanup_result AS
SELECT public.cleanup_cron_metrics('retention-old', 999999) AS response;

SELECT pg_temp.assert_true(
  (SELECT (response->>'deleted')::int = 5000
          AND (response->>'batch_cap')::int = 5000
   FROM cron_metrics_cleanup_result)
  AND
  (SELECT count(*) = 1 FROM public.cron_metrics WHERE cron_name = 'retention-fresh')
  AND
  (SELECT count(*) = 1 FROM public.cron_metrics WHERE cron_name = 'retention-other'),
  'cron metric cleanup is capped and scoped to cron_name'
);

-- pg_cron history: only old, finished rows are eligible. Negative run ids keep
-- disposable fixtures separate from extension-generated history.
INSERT INTO cron.job_run_details (
  jobid, runid, database, username, command, status, start_time, end_time
)
VALUES
  (0, -91001, current_database(), current_user, 'SELECT 1', 'succeeded', now() - interval '8 days', now() - interval '8 days'),
  (0, -91002, current_database(), current_user, 'SELECT 1', 'failed',    now() - interval '8 days', now() - interval '8 days'),
  (0, -91003, current_database(), current_user, 'SELECT 1', 'running',   now() - interval '8 days', NULL),
  (0, -91004, current_database(), current_user, 'SELECT 1', 'connecting',now() - interval '8 days', NULL),
  (0, -91005, current_database(), current_user, 'SELECT 1', 'succeeded', now(), now());

CREATE TEMP TABLE cron_run_cleanup_result AS
SELECT public.cleanup_cron_job_run_details(5000) AS response;

SELECT pg_temp.assert_true(
  (SELECT (response->>'deleted')::int = 2 FROM cron_run_cleanup_result)
  AND
  (SELECT count(*) = 3 FROM cron.job_run_details WHERE runid BETWEEN -91005 AND -91001)
  AND
  (SELECT count(*) = 2 FROM cron.job_run_details
   WHERE runid IN (-91003, -91004) AND status IN ('running', 'connecting')),
  'cron cleanup preserves running, connecting, and recent rows'
);

ROLLBACK;
