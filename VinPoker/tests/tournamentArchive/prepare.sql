CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text, username text, active boolean);
INSERT INTO cron.job VALUES ('auto-soft-delete-old-tournaments', 'postgres', true);

CREATE TABLE public.tournaments (
  id integer PRIMARY KEY,
  status text NOT NULL,
  start_time timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz
);
CREATE TABLE public.table_sessions (
  id integer PRIMARY KEY,
  tournament_id integer NOT NULL,
  closed_at timestamptz
);
CREATE FUNCTION public.auto_soft_delete_old_tournaments()
RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
GRANT EXECUTE ON FUNCTION public.auto_soft_delete_old_tournaments()
  TO authenticated, service_role;

INSERT INTO public.tournaments (id,status,start_time) VALUES
  (1,'live',now()-interval '2 days'),
  (2,'active',now()-interval '2 days'),
  (3,'completed',now()-interval '2 days'),
  (4,'cancelled',now()-interval '2 days'),
  (5,'completed',now()-interval '12 hours'),
  (6,'completed',NULL),
  (7,'finished',now()-interval '2 days');
INSERT INTO public.table_sessions (id,tournament_id,closed_at) VALUES
  (1,1,NULL),
  (2,4,NULL),
  (3,7,now()-interval '1 hour');
