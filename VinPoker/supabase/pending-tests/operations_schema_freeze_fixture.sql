-- Disposable qualification instrumentation only. Never a production migration.
BEGIN;
DO $$ BEGIN
 IF current_user<>'postgres'
 OR current_setting('vinpoker.isolated_schema_fence',true) IS DISTINCT FROM 'cashier-current-schema-v1'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'vinpoker-operational-schema-fence-disposable'
 OR to_regnamespace('ops_load_fixture_v1') IS NOT NULL
 OR to_regprocedure('public.fixture_operations_schema_ready_v1()') IS NOT NULL
 THEN RAISE EXCEPTION 'isolated_schema_fence_target_required';END IF;
END $$;
CREATE SCHEMA ops_load_fixture_v1;
REVOKE ALL ON SCHEMA ops_load_fixture_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE ops_load_fixture_v1.schema_fence(singleton boolean PRIMARY KEY CHECK(singleton),frozen boolean NOT NULL,admission_at timestamptz);
INSERT INTO ops_load_fixture_v1.schema_fence VALUES(true,false,NULL);
ALTER TABLE ops_load_fixture_v1.schema_fence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops_load_fixture_v1.schema_fence FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ops_load_fixture_v1.guard_schema() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE singleton AND frozen) THEN
  RAISE EXCEPTION 'isolated_schema_frozen_during_audience' USING ERRCODE='55000';
 END IF;
END $$;
REVOKE ALL ON FUNCTION ops_load_fixture_v1.guard_schema() FROM PUBLIC,anon,authenticated,service_role;
CREATE EVENT TRIGGER ops_load_schema_frozen ON ddl_command_start EXECUTE FUNCTION ops_load_fixture_v1.guard_schema();
CREATE FUNCTION ops_load_fixture_v1.catalog_fingerprint() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(string_agg(value,E'\n' ORDER BY value)) FROM (
  SELECT 'p:'||p.oid||':'||md5(p.prosrc)||':'||p.proowner||':'||p.prosecdef||':'||p.provolatile::text||':'||p.prorettype||':'||p.proargtypes::text||':'||coalesce(p.proargnames::text,'')||':'||coalesce(p.proargdefaults::text,'')||':'||coalesce(p.proconfig::text,'')||':'||coalesce(p.proacl::text,'') AS value
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
  UNION ALL
  SELECT 'c:'||c.oid||':'||c.relkind::text||':'||c.relowner||':'||c.relrowsecurity||':'||c.relforcerowsecurity||':'||coalesce(c.relacl::text,'') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
  UNION ALL
  SELECT 'a:'||a.attrelid||':'||a.attnum||':'||a.attname||':'||a.atttypid||':'||a.atttypmod||':'||a.attnotnull||':'||a.attisdropped||':'||coalesce(a.attacl::text,'') FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
  UNION ALL SELECT 't:'||t.oid||':'||t.tgenabled::text||':'||pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE NOT t.tgisinternal
  UNION ALL SELECT 'k:'||k.oid||':'||pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
  UNION ALL SELECT 'i:'||i.indexrelid||':'||pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
  UNION ALL SELECT 'e:'||e.oid||':'||e.evtenabled::text||':'||e.evtfoid FROM pg_event_trigger e
  UNION ALL SELECT 'r:'||r.oid||':'||r.polrelid||':'||r.polroles::text||':'||r.polcmd::text||':'||r.polpermissive||':'||coalesce(r.polqual::text,'')||':'||coalesce(r.polwithcheck::text,'') FROM pg_policy r
  UNION ALL SELECT 'n:'||n.oid||':'||n.nspowner||':'||coalesce(n.nspacl::text,'') FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 ) rows;
$$;
REVOKE ALL ON FUNCTION ops_load_fixture_v1.catalog_fingerprint() FROM PUBLIC,anon,authenticated,service_role;
-- Cache acknowledgment only: no product data, source rows or permissions are
-- simulated. PostgREST cannot expose this new signature until a cache reload
-- that includes all preceding canonical schema installation has completed.
CREATE FUNCTION public.fixture_operations_schema_ready_v1() RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT 'operations-complete-schema-v1'::text;
$$;
REVOKE ALL ON FUNCTION public.fixture_operations_schema_ready_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fixture_operations_schema_ready_v1() TO anon;
COMMIT;
