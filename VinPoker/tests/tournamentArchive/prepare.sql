CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text, username text, active boolean);
ALTER TABLE cron.job ADD COLUMN command text;
INSERT INTO cron.job VALUES ('auto-soft-delete-old-tournaments', 'postgres', true,
  ' SELECT public.auto_soft_delete_old_tournaments(); ');

CREATE TABLE public.tournaments (
  id integer PRIMARY KEY,
  status text NOT NULL,
  start_time timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz,
  CONSTRAINT tournaments_ops_status_check CHECK (status IN
    ('active','upcoming','registering','drawing','live','break','final_table','completed','cancelled'))
);
CREATE TABLE public.table_sessions (
  id integer PRIMARY KEY,
  tournament_id integer NOT NULL,
  closed_at timestamptz
);
CREATE FUNCTION public.auto_soft_delete_old_tournaments()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  cnt integer := 0;
BEGIN
  WITH upd AS (
    UPDATE public.tournaments
    SET deleted_at = now(), updated_at = now()
    WHERE deleted_at IS NULL
      AND start_time IS NOT NULL
      AND start_time < (now() - INTERVAL '24 hours')
    RETURNING 1
  )
  SELECT count(*) INTO cnt FROM upd;
  RETURN cnt;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_soft_delete_old_tournaments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_soft_delete_old_tournaments()
  TO authenticated, service_role;

INSERT INTO public.tournaments (id,status,start_time) VALUES
  (1,'live',now()-interval '2 days'),
  (2,'active',now()-interval '2 days'),
  (3,'completed',now()-interval '2 days'),
  (4,'cancelled',now()-interval '2 days'),
  (5,'completed',now()-interval '12 hours'),
  (6,'completed',NULL),
  (7,'cancelled',now()-interval '2 days');
INSERT INTO public.table_sessions (id,tournament_id,closed_at) VALUES
  (1,1,NULL),
  (2,4,NULL),
  (3,7,now()-interval '1 hour');
