-- Dealer rotation set-diff contract tests. Disposable database only.
-- Run after 20270103000000_upsert_rotation_plan_diff.sql; all writes roll back.

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

CREATE OR REPLACE FUNCTION pg_temp.plan_row(
  p_table_id uuid,
  p_slot_index int,
  p_relief_at timestamptz,
  p_score numeric,
  p_shortage boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'table_id', p_table_id,
    'slot_index', p_slot_index,
    'planned_relief_at', p_relief_at,
    'announce_at', p_relief_at - interval '5 minutes',
    'is_shortage', p_shortage,
    'solver_version', 'diff-test-v1',
    'score', p_score,
    'reason', jsonb_build_object(
      'fixture', true,
      'needAtMs', extract(epoch FROM p_relief_at) * 1000
    )
  );
$$;

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.upsert_rotation_plan(uuid,uuid,jsonb,uuid[])',
    'EXECUTE'
  ),
  'planner write remains service-role only'
);

INSERT INTO public.clubs (id, name, region, status)
VALUES ('a1000000-0000-4000-8000-000000000001', 'ROTATION DIFF TEST', 'TEST', 'approved');

INSERT INTO public.game_tables (id, club_id, table_name, status)
VALUES
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'DIFF 1', 'active'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'DIFF 2', 'active'),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'DIFF 3', 'active');

CREATE TEMP TABLE first_plan_snapshot AS
SELECT public.upsert_rotation_plan(
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  jsonb_build_array(
    pg_temp.plan_row('a2000000-0000-4000-8000-000000000001', 0, '2030-01-01 10:00:00+00', 10),
    pg_temp.plan_row('a2000000-0000-4000-8000-000000000002', 0, '2030-01-01 10:05:00+00', 20)
  ),
  NULL
) AS response;

SELECT pg_temp.assert_true(
  (SELECT response->>'outcome' = 'ok'
          AND (response->>'inserted')::int = 2
          AND (response->>'superseded')::int = 0
          AND (response->>'unchanged')::int = 0
   FROM first_plan_snapshot),
  'first plan inserts two predictions'
);

CREATE TEMP TABLE original_live_rows AS
SELECT id, table_id, slot_index, plan_run_id, version, updated_at
FROM public.dealer_rotation_schedule
WHERE club_id = 'a1000000-0000-4000-8000-000000000001'
  AND status = 'predicted';

CREATE TEMP TABLE identical_plan_snapshot AS
SELECT public.upsert_rotation_plan(
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000002',
  jsonb_build_array(
    pg_temp.plan_row('a2000000-0000-4000-8000-000000000001', 0, '2030-01-01 10:01:00+00', 999),
    pg_temp.plan_row('a2000000-0000-4000-8000-000000000002', 0, '2030-01-01 10:06:00+00', 999)
  ),
  NULL
) AS response;

SELECT pg_temp.assert_true(
  (SELECT (response->>'inserted')::int = 0
          AND (response->>'superseded')::int = 0
          AND (response->>'unchanged')::int = 2
   FROM identical_plan_snapshot),
  'same operational plan ignores run-local timestamp and diagnostic drift'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.dealer_rotation_schedule AS current_row
    FULL JOIN original_live_rows AS original
      USING (id, table_id, slot_index, plan_run_id, version, updated_at)
    WHERE current_row.club_id = 'a1000000-0000-4000-8000-000000000001'
      AND current_row.status = 'predicted'
      AND original.id IS NULL
  )
  AND (SELECT count(*) = 2 FROM public.dealer_rotation_schedule
       WHERE club_id = 'a1000000-0000-4000-8000-000000000001'),
  'identical plan preserves row identity, version, timestamp, and row count'
);

CREATE TEMP TABLE changed_plan_snapshot AS
SELECT public.upsert_rotation_plan(
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003',
  jsonb_build_array(
    pg_temp.plan_row('a2000000-0000-4000-8000-000000000001', 0, '2030-01-01 10:00:00+00', 11, true),
    pg_temp.plan_row('a2000000-0000-4000-8000-000000000002', 0, '2030-01-01 10:05:00+00', 20)
  ),
  NULL
) AS response;

SELECT pg_temp.assert_true(
  (SELECT (response->>'inserted')::int = 1
          AND (response->>'superseded')::int = 1
          AND (response->>'unchanged')::int = 1
   FROM changed_plan_snapshot),
  'one changed slot supersedes one row and inserts one row'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.dealer_rotation_schedule
   WHERE table_id = 'a2000000-0000-4000-8000-000000000001'
     AND slot_index = 0
     AND status = 'predicted'
     AND score = 11)
  AND
  (SELECT count(*) = 1 FROM public.dealer_rotation_schedule
   WHERE table_id = 'a2000000-0000-4000-8000-000000000001'
     AND slot_index = 0
     AND status = 'superseded'),
  'changed slot has exactly one old and one live row'
);

-- A sticky row owns table 1/slot 0; a later planner may not rewrite it.
UPDATE public.dealer_rotation_schedule
SET status = 'announced'
WHERE table_id = 'a2000000-0000-4000-8000-000000000001'
  AND slot_index = 0
  AND status = 'predicted';

SELECT public.upsert_rotation_plan(
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000004',
  jsonb_build_array(
    pg_temp.plan_row('a2000000-0000-4000-8000-000000000001', 0, '2030-01-01 11:00:00+00', 99)
  ),
  ARRAY['a2000000-0000-4000-8000-000000000001'::uuid]
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.dealer_rotation_schedule
   WHERE table_id = 'a2000000-0000-4000-8000-000000000001'
     AND slot_index = 0
     AND status = 'announced'
     AND score = 11)
  AND
  (SELECT count(*) = 0 FROM public.dealer_rotation_schedule
   WHERE table_id = 'a2000000-0000-4000-8000-000000000001'
     AND slot_index = 0
     AND status = 'predicted'),
  'announced ownership is sticky'
);

-- Seed table 3, then prove an empty partial plan only retires table 3.
SELECT public.upsert_rotation_plan(
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000005',
  jsonb_build_array(
    pg_temp.plan_row('a2000000-0000-4000-8000-000000000003', 0, '2030-01-01 10:10:00+00', 30)
  ),
  ARRAY['a2000000-0000-4000-8000-000000000003'::uuid]
);

-- Table 2 represents a quarantined table omitted from the valid-table scope.
CREATE TEMP TABLE quarantined_schedule_fingerprint AS
SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) AS fingerprint
FROM public.dealer_rotation_schedule s
WHERE s.table_id = 'a2000000-0000-4000-8000-000000000002';

SELECT pg_temp.assert_true(
  (SELECT jsonb_array_length(fingerprint) = 1
          AND fingerprint->0->>'status' = 'predicted'
   FROM quarantined_schedule_fingerprint),
  'quarantined fingerprint starts from one real predicted row, not an empty snapshot'
);

CREATE TEMP TABLE empty_partial_snapshot AS
SELECT public.upsert_rotation_plan(
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000006',
  '[]'::jsonb,
  ARRAY['a2000000-0000-4000-8000-000000000003'::uuid]
) AS response;

SELECT pg_temp.assert_true(
  (SELECT (response->>'superseded')::int = 1
          AND (response->>'inserted')::int = 0
   FROM empty_partial_snapshot)
  AND
  (SELECT count(*) = 1 FROM public.dealer_rotation_schedule
   WHERE table_id = 'a2000000-0000-4000-8000-000000000002'
     AND status = 'predicted'),
  'empty partial plan retires predicted rows only inside p_table_ids'
);

SELECT pg_temp.assert_true(
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
   FROM public.dealer_rotation_schedule s
   WHERE s.table_id = 'a2000000-0000-4000-8000-000000000002')
  IS NOT DISTINCT FROM (SELECT fingerprint FROM quarantined_schedule_fingerprint),
  'quarantined table schedule full-row fingerprint remains unchanged'
);

ROLLBACK;
