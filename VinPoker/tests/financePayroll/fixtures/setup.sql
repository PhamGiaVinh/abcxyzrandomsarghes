\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'finance_payroll_test' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
END $$;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('super_admin', 'club_admin');
CREATE TABLE public.test_roles(user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(actor uuid, expected public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS(SELECT 1 FROM public.test_roles WHERE user_id=actor AND role=expected) $$;
CREATE TABLE public.clubs(id uuid PRIMARY KEY, owner_id uuid);
CREATE TABLE public.club_cashiers(club_id uuid, user_id uuid);
CREATE TABLE public.club_accountants(club_id uuid, user_id uuid);
CREATE TABLE public.dealers(id uuid PRIMARY KEY, club_id uuid, status text, employment_type text, deleted_at timestamptz, full_name text);
CREATE TABLE public.dealer_pt_wage_accrual_policies(club_id uuid, standby_accrual_enabled boolean, effective_from timestamptz);
CREATE TABLE public.dealer_pt_wage_payments(dealer_id uuid, amount_vnd bigint, paid_at timestamptz, voided_at timestamptz);
-- Synthetic calculator isolates authorization and projection parity. This fixture does not qualify real wage arithmetic.
CREATE FUNCTION public._pt_wage_balance(dealer uuid) RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT jsonb_build_object('dealer_id', id, 'full_name', full_name, 'balance_vnd', 12345) FROM public.dealers WHERE id=dealer $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
INSERT INTO public.clubs VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000022');
INSERT INTO public.club_accountants VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000033');
INSERT INTO public.club_cashiers VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000044');
INSERT INTO public.dealers VALUES
 ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000001','active','part_time',NULL,'TEST A'),
 ('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000002','active','part_time',NULL,'TEST B');
