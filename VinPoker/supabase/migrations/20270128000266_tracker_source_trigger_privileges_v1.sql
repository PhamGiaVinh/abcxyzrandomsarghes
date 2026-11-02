-- Client roles must not install code on canonical hand source tables. TEMP
-- functions plus TRIGGER privilege can bypass column-specific revision guards.
-- This does not alter existing triggers or actor-authorized row write paths.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$
DECLARE source_table regclass;actor_role text;before_other jsonb;after_other jsonb;service_trigger boolean;
BEGIN
 FOREACH source_table IN ARRAY ARRAY['public.tournament_hands'::regclass,
   'public.hand_actions'::regclass,'public.hand_players'::regclass] LOOP
  service_trigger:=has_table_privilege('service_role',source_table,'TRIGGER');
  SELECT jsonb_agg(jsonb_build_array(r.role,p.privilege,has_table_privilege(r.role,source_table,p.privilege)) ORDER BY r.role,p.privilege)
   INTO before_other FROM (VALUES('anon'),('authenticated'),('service_role'))r(role)
   CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('REFERENCES'),('TRUNCATE'))p(privilege);
  EXECUTE format('REVOKE TRIGGER ON TABLE %s FROM PUBLIC,anon,authenticated',source_table);
  FOREACH actor_role IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_table_privilege(actor_role,source_table,'TRIGGER') THEN
    RAISE EXCEPTION 'tracker_source_trigger_inherited_grant:%:%',source_table,actor_role;
   END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_array(r.role,p.privilege,has_table_privilege(r.role,source_table,p.privilege)) ORDER BY r.role,p.privilege)
   INTO after_other FROM (VALUES('anon'),('authenticated'),('service_role'))r(role)
   CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('REFERENCES'),('TRUNCATE'))p(privilege);
  IF before_other IS DISTINCT FROM after_other THEN RAISE EXCEPTION 'tracker_source_nontrigger_privilege_drift:%',source_table;END IF;
  IF service_trigger IS DISTINCT FROM has_table_privilege('service_role',source_table,'TRIGGER') THEN
   RAISE EXCEPTION 'tracker_source_service_trigger_privilege_drift:%',source_table;
  END IF;
 END LOOP;
END $$;
COMMIT;
