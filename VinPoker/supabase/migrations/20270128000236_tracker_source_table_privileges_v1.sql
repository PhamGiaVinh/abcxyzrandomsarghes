-- Forward-only privilege hardening. TRUNCATE bypasses row-level source revision
-- triggers and RLS. No browser operation requires this table-wide capability.
-- Preserve all DML/sequence/function permissions and the service maintenance role.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$
DECLARE source_table regclass; actor_role text; before_dml jsonb; after_dml jsonb; service_truncate boolean;
BEGIN
 FOREACH source_table IN ARRAY ARRAY['public.tournament_hands'::regclass,
   'public.hand_actions'::regclass,'public.hand_players'::regclass] LOOP
  service_truncate:=has_table_privilege('service_role',source_table,'TRUNCATE');
  SELECT jsonb_agg(jsonb_build_array(r.role,p.privilege,has_table_privilege(r.role,source_table,p.privilege)) ORDER BY r.role,p.privilege)
   INTO before_dml FROM (VALUES('anon'),('authenticated'),('service_role')) r(role)
   CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('REFERENCES'),('TRIGGER')) p(privilege);
  EXECUTE format('REVOKE TRUNCATE ON TABLE %s FROM PUBLIC, anon, authenticated',source_table);
  FOREACH actor_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_table_privilege(actor_role,source_table,'TRUNCATE') THEN
    RAISE EXCEPTION 'tracker_source_truncate_inherited_grant:%:%',source_table,actor_role;
   END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_array(r.role,p.privilege,has_table_privilege(r.role,source_table,p.privilege)) ORDER BY r.role,p.privilege)
   INTO after_dml FROM (VALUES('anon'),('authenticated'),('service_role')) r(role)
   CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('REFERENCES'),('TRIGGER')) p(privilege);
  IF before_dml IS DISTINCT FROM after_dml THEN RAISE EXCEPTION 'tracker_source_nontruncate_privilege_drift:%',source_table;END IF;
  IF service_truncate IS DISTINCT FROM has_table_privilege('service_role',source_table,'TRUNCATE') THEN
   RAISE EXCEPTION 'tracker_source_service_privilege_drift:%',source_table;
  END IF;
 END LOOP;
END $$;
COMMIT;
