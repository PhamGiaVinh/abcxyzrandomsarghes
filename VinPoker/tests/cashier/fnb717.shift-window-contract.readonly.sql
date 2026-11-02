\set ON_ERROR_STOP on
-- Diagnostic of the archived shift proposal's algorithm, NOT a product PASS.
-- No archive replay, fixture, money mutation, role or schema change.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE duplicate_at_boundary integer; stale_cutoff integer; actual_cutoff integer;
 transaction_start timestamptz:=now(); first_wall timestamptz:=clock_timestamp(); BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL;
 ASSERT to_regprocedure('public.fnb_get_shift_report(uuid)') IS NULL;

 -- Equal cutover instants are legal timestamp values. BETWEEN attributes the
 -- same paid event to both adjacent shifts; do not claim this was a live shift.
 WITH windows(opened_at,closed_at) AS (VALUES
  ('2026-10-24 09:00:00+07'::timestamptz,'2026-10-24 10:00:00+07'::timestamptz),
  ('2026-10-24 10:00:00+07'::timestamptz,'2026-10-24 11:00:00+07'::timestamptz))
 SELECT count(*) INTO duplicate_at_boundary FROM windows
 WHERE '2026-10-24 10:00:00+07'::timestamptz BETWEEN opened_at AND closed_at;
 ASSERT duplicate_at_boundary=2,'original inclusive algorithm counterexample must remain visible';

 -- A closer transaction can start before a payment that commits before its
 -- actual cutover. now() is its transaction start, not a post-lock cutoff.
 WITH payment(paid_at) AS (VALUES('2026-10-24 10:00:01+07'::timestamptz))
 SELECT count(*) FILTER(WHERE paid_at BETWEEN '2026-10-24 09:00:00+07'::timestamptz AND '2026-10-24 10:00:00+07'::timestamptz),
  count(*) FILTER(WHERE paid_at >= '2026-10-24 09:00:00+07'::timestamptz AND paid_at < '2026-10-24 10:00:02+07'::timestamptz)
 INTO stale_cutoff,actual_cutoff FROM payment;
 ASSERT stale_cutoff=0 AND actual_cutoff=1,'transaction-start cutoff can omit a committed pre-cutover payment';
 PERFORM pg_sleep(0.02);
 ASSERT now()=transaction_start AND clock_timestamp()>first_wall,'native PostgreSQL transaction timestamp behavior';
END $$;
ROLLBACK;
SELECT 'FNB717_ARCHIVED_WINDOW_COUNTEREXAMPLES_CONFIRMED_NOT_IMPLEMENTED_SHIFT_ACCEPTANCE';
