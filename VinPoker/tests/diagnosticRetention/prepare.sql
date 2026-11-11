-- Disposable fixture only. Hosted ownership/RLS/PK shape observed read-only.
\set ON_ERROR_STOP on
CREATE SCHEMA retention_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA retention_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.diagnostic_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),timestamp timestamptz,club_id uuid,
 diagnostic_type text,result jsonb,metadata jsonb,created_at timestamptz
);
ALTER TABLE public.diagnostic_logs OWNER TO postgres;
ALTER TABLE public.diagnostic_logs ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.cleanup_old_diagnostic_logs()
RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  DELETE FROM diagnostic_logs
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$function$;
ALTER FUNCTION public.cleanup_old_diagnostic_logs() OWNER TO postgres;
DO $$BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.cleanup_old_diagnostic_logs()'::regprocedure))<>'270e91b946d67a6be9cfece5b06f1ac3' THEN
   RAISE EXCEPTION 'fixture predecessor differs from hosted source'; END IF;
END$$;
