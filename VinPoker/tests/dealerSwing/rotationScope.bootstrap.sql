-- Narrow isolated PG17 fixture for actual upsert SQL, NOT a recovered live schema.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'vinpoker_rotation_scope_ci'
    OR current_user <> 'postgres'
    OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet)
    OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
    OR EXISTS (SELECT FROM pg_tables WHERE schemaname='public') THEN
    RAISE EXCEPTION 'Empty dedicated CI loopback PostgreSQL17 database required';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,name text,region text,status text);
CREATE TABLE public.game_tables(
 id uuid PRIMARY KEY,club_id uuid NOT NULL REFERENCES public.clubs(id),table_name text,status text
);
CREATE TABLE public.dealer_rotation_schedule(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 table_id uuid NOT NULL REFERENCES public.game_tables(id),
 assignment_id uuid,slot_index integer NOT NULL DEFAULT 0 CHECK(slot_index BETWEEN 0 AND 4),
 out_attendance_id uuid,in_attendance_id uuid,planned_relief_at timestamptz NOT NULL,
 announce_at timestamptz,status text NOT NULL DEFAULT 'predicted',
 is_shortage boolean NOT NULL DEFAULT false,is_emergency boolean NOT NULL DEFAULT false,
 plan_run_id uuid NOT NULL,solver_version text NOT NULL,score numeric,
 reason jsonb NOT NULL DEFAULT '{}'::jsonb,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_rotation_active_slot ON public.dealer_rotation_schedule(table_id,slot_index)
 WHERE status IN('predicted','announced','executing');
CREATE UNIQUE INDEX uq_rotation_locked_dealer ON public.dealer_rotation_schedule(in_attendance_id)
 WHERE status IN('announced','executing');
CREATE UNIQUE INDEX uq_rotation_announced_assignment ON public.dealer_rotation_schedule(assignment_id)
 WHERE status IN('announced','executing');
