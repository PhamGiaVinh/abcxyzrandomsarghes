-- Fixed aggregate fields only. No statements, parameters, users or claims leave PG.
BEGIN READ ONLY;
SET LOCAL statement_timeout='1s';
SELECT jsonb_build_object(
 'scopeReady',current_user='postgres'
  AND (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='vinpoker-operational-schema-fence-disposable'
  AND (SELECT frozen FROM ops_load_fixture_v1.schema_fence WHERE singleton),
 'observedAtMs',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,
 'clients',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY client) FROM (
  SELECT CASE WHEN usename='authenticator' THEN 'postgrest' ELSE 'other' END client,
   count(*)::integer connections,
   count(*) FILTER(WHERE state='active')::integer active,
   count(*) FILTER(WHERE state='idle')::integer idle,
   count(*) FILTER(WHERE state IN ('idle in transaction','idle in transaction (aborted)'))::integer idle_in_transaction,
   count(*) FILTER(WHERE state='active' AND wait_event_type='Lock')::integer lock_wait,
   count(*) FILTER(WHERE state='active' AND wait_event_type='IO')::integer io_wait,
   count(*) FILTER(WHERE state='active' AND wait_event_type='LWLock')::integer lwlock_wait,
   count(*) FILTER(WHERE state='active' AND wait_event_type='Client')::integer client_wait,
   count(*) FILTER(WHERE state='active' AND wait_event_type IS NULL)::integer running,
   coalesce(max(greatest(0,extract(epoch FROM clock_timestamp()-query_start)*1000)) FILTER(WHERE state='active'),0)::double precision max_active_ms
  FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()
  GROUP BY CASE WHEN usename='authenticator' THEN 'postgrest' ELSE 'other' END
 ) s),'[]'::jsonb));
ROLLBACK;
