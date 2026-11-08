CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,name text,region text,status text);
CREATE TABLE public.game_tables(id uuid PRIMARY KEY,club_id uuid REFERENCES public.clubs,table_name text,status text);
CREATE TABLE public.dealer_rotation_schedule(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid REFERENCES public.clubs,
  table_id uuid REFERENCES public.game_tables,slot_index integer,planned_relief_at timestamptz,
  status text CHECK(status IN('predicted','announced','executing','superseded','executed','cancelled','no_show')),
  plan_run_id uuid,solver_version text
);
CREATE INDEX idx_rotation_due ON public.dealer_rotation_schedule(club_id,status,planned_relief_at);
CREATE UNIQUE INDEX uq_rotation_active_slot ON public.dealer_rotation_schedule(table_id,slot_index)
  WHERE status IN('predicted','announced','executing');
CREATE TABLE public.diagnostic_logs(id uuid DEFAULT gen_random_uuid(),timestamp timestamptz,created_at timestamptz,club_id uuid,diagnostic_type text,result jsonb);
CREATE TABLE public.cron_metrics(id uuid DEFAULT gen_random_uuid(),cron_name text,duration_ms integer,status text,executed_at timestamptz,created_at timestamptz);
