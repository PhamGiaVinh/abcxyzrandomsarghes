-- Read-only regression on the same browser single-day journey; no repair.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441 THEN
  RAISE EXCEPTION 'isolated_native_only';
 END IF;
END $$;
SET LOCAL request.jwt.claim.sub='065801a0-565e-4bd6-9c2d-ee252b7e6494';
SET LOCAL request.jwt.claims='{"sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494","role":"authenticated"}';
SELECT public.get_tournament_participation_v1('b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f')->'counts' AS actual_counts;
SELECT (value->'counts'->>'seated')::integer=1
 AND (value->'counts'->>'anomaly_seats')::integer=0
 AND (value->'counts'->>'seated_stack')::integer=20000 AS projection_ok
FROM(SELECT public.get_tournament_participation_v1('b72cb86e-b2f7-4b32-9b1b-b5fff911ea2f') value) p \gset
\if :projection_ok
 SELECT 'PAID_SEAT_PROJECTION_EXACT_BROWSER_JOURNEY_PASS';
\else
 DO $$ BEGIN RAISE EXCEPTION 'PAID_SEAT_PROJECTION_MISSING_OR_INCONSISTENT'; END $$;
\endif
ROLLBACK;
