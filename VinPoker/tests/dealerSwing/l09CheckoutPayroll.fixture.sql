\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_l09' THEN
    RAISE EXCEPTION 'Expected disposable L09 database';
  END IF;
END $$;

CREATE TABLE public.l09_checkout_fixture (
  sample int PRIMARY KEY,
  workload text NOT NULL,
  actor_id uuid NOT NULL,
  checkout_club_id uuid NOT NULL,
  payroll_club_id uuid NOT NULL,
  attendance_id uuid NOT NULL,
  month_start date NOT NULL
);

-- Use independent fixtures so no previous checkout, receipt, or monthly save
-- can turn a measured write into an idempotent response.
DO $$
DECLARE
  owner_id uuid;
  club_a uuid;
  club_b uuid;
  shift_id uuid;
  dealer_id uuid;
  attendance_id uuid;
  month_start date := date_trunc('month', timezone('Asia/Ho_Chi_Minh', now()))::date;
  started_at timestamptz := greatest(now() - interval '2 hours', month_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  arm text;
BEGIN
  FOR sample IN 1..80 LOOP
    arm := (ARRAY['baseline', 'same_club_same_month', 'same_club_previous_month', 'other_club'])[1 + (sample - 1) % 4];
    owner_id := gen_random_uuid();
    club_a := gen_random_uuid();
    club_b := gen_random_uuid();
    shift_id := gen_random_uuid();
    dealer_id := gen_random_uuid();
    attendance_id := gen_random_uuid();
    INSERT INTO auth.users(id) VALUES (owner_id);
    INSERT INTO public.profiles(user_id, display_name) VALUES (owner_id, 'L09 TEST owner');
    INSERT INTO public.clubs(id, owner_id, name, region, status) VALUES
      (club_a, owner_id, 'L09 TEST A ' || sample, 'TEST', 'approved'),
      (club_b, owner_id, 'L09 TEST B ' || sample, 'TEST', 'approved');
    INSERT INTO public.dealer_shifts(id, club_id, tour_name, start_time, end_time)
      VALUES (shift_id, club_a, 'L09 TEST', '08:00', '23:00');
    INSERT INTO public.dealers(id, club_id, full_name, status, employment_type, monthly_salary_vnd)
      VALUES (dealer_id, club_a, 'L09 TEST dealer', 'active', 'full_time', 5200000);
    INSERT INTO public.dealer_attendance(id, dealer_id, shift_id, shift_date, status, check_in_time, current_state)
      VALUES (attendance_id, dealer_id, shift_id, timezone('Asia/Ho_Chi_Minh', started_at)::date,
        'checked_in', started_at, 'available');
    INSERT INTO public.l09_checkout_fixture VALUES (sample, arm, owner_id, club_a,
      CASE WHEN arm = 'other_club' THEN club_b ELSE club_a END, attendance_id,
      CASE WHEN arm = 'same_club_previous_month' THEN (month_start - interval '1 month')::date ELSE month_start END);
  END LOOP;
END $$;
COMMIT;
