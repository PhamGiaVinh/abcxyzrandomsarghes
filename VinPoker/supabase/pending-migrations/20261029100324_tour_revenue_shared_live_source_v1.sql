-- Pending LOCAL qualification. Keep finance authorization in the public wrapper;
-- both live and buy-close capture use the existing private receipt classifier.
-- Rollback: forward restore the exact raw definition saved below; archive/drop
-- the private backup only after verifying restoration. No financial data undo.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $patch$
DECLARE b record; a record; internal record; split_at integer; private_split integer;
 definition text; patched_body text;
BEGIN
 SELECT p.*,pg_get_functiondef(p.oid) AS definition INTO STRICT b
 FROM pg_proc p WHERE oid='public.get_owner_tour_rake_live_v1(uuid)'::regprocedure;
 SELECT * INTO STRICT internal FROM pg_proc
 WHERE oid='floor_private.tour_revenue_live_source_v1(uuid)'::regprocedure;
 IF current_user<>'postgres' OR md5(b.prosrc)<>'0789f3ee623845e4624d848f7693a263'
 OR md5(internal.prosrc)<>'67ea8cc36824b34ef7006b9a8b36e923'
 OR pg_get_userbyid(b.proowner)<>'postgres' OR pg_get_userbyid(internal.proowner)<>'postgres'
 OR NOT internal.prosecdef OR internal.provolatile<>'s'
 OR has_function_privilege('anon',internal.oid,'EXECUTE')
 OR has_function_privilege('authenticated',internal.oid,'EXECUTE')
 OR has_function_privilege('service_role',internal.oid,'EXECUTE')
 OR to_regclass('floor_private.tour_revenue_live_definition_backup_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'tour_revenue_shared_source_dependency_drift_or_collision';
 END IF;
 split_at:=strpos(b.prosrc,' WITH receipts AS (');
 private_split:=strpos(internal.prosrc,' WITH receipts AS (');
 IF split_at=0 OR private_split=0
 OR substr(b.prosrc,split_at) IS DISTINCT FROM substr(internal.prosrc,private_split) THEN
  RAISE EXCEPTION 'tour_revenue_classifier_copy_drift';
 END IF;
 CREATE TABLE floor_private.tour_revenue_live_definition_backup_v1(
  signature text PRIMARY KEY,definition text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.tour_revenue_live_definition_backup_v1 ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.tour_revenue_live_definition_backup_v1 FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.tour_revenue_live_definition_backup_v1(signature,definition)
 VALUES('public.get_owner_tour_rake_live_v1(uuid)',b.definition);
 -- Preserve the entire existing auth/scope prefix. Only delegate classification.
 patched_body:=substr(b.prosrc,1,split_at-1)
  ||E' RETURN floor_private.tour_revenue_live_source_v1(p_club_id);\nEND;\n';
 EXECUTE replace(b.definition,b.prosrc,patched_body);
 SELECT * INTO STRICT a FROM pg_proc WHERE oid=b.oid;
 IF a.proacl IS DISTINCT FROM b.proacl OR a.proowner<>b.proowner
 OR a.prosecdef IS DISTINCT FROM b.prosecdef OR a.proconfig IS DISTINCT FROM b.proconfig
 OR a.provolatile IS DISTINCT FROM b.provolatile OR strpos(a.prosrc,' WITH receipts AS (')<>0
 OR md5((SELECT prosrc FROM pg_proc WHERE oid=internal.oid))<>md5(internal.prosrc) THEN
  RAISE EXCEPTION 'tour_revenue_shared_source_metadata_drift';
 END IF;
END $patch$;
COMMIT;
