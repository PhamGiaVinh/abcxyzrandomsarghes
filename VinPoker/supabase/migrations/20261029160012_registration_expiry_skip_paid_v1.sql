-- LOCAL qualification candidate; not promoted / not for production DB push.
-- A paid pending registration waits for seating, not payment timeout. Preserve
-- cashier_paid_registration_guard_v1 and all historical receipt values.
-- Recovery: execute the exact saved definition inside a guarded transaction.
DO $patch$
DECLARE b record;a record;needle text;patched text;
BEGIN
 SELECT p.*,pg_get_functiondef(p.oid) definition INTO STRICT b FROM pg_proc p
 WHERE p.oid='public.auto_cancel_expired_tournament_regs()'::regprocedure;
 IF current_user<>'postgres' OR md5(b.prosrc)<>'3ca55ce20d22a9295bb88f22d51f0a1e'
 OR pg_get_userbyid(b.proowner)<>'postgres' OR NOT b.prosecdef
 OR to_regclass('floor_private.registration_expiry_definition_backup_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'registration_expiry_dependency_drift_or_collision';
 END IF;
 needle:=E'    WHERE status = ''pending''';
 IF strpos(b.prosrc,needle)=0
 OR length(b.prosrc)-length(replace(b.prosrc,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'registration_expiry_predicate_drift';
 END IF;
 CREATE TABLE floor_private.registration_expiry_definition_backup_v1(
  signature text PRIMARY KEY,definition text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.registration_expiry_definition_backup_v1 ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.registration_expiry_definition_backup_v1 FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.registration_expiry_definition_backup_v1(signature,definition)
 VALUES('public.auto_cancel_expired_tournament_regs()',b.definition);
 patched:=replace(b.prosrc,needle,needle||E'\n      AND cashier_paid_at IS NULL');
 EXECUTE replace(b.definition,b.prosrc,patched);
 SELECT * INTO STRICT a FROM pg_proc WHERE oid=b.oid;
 IF a.proacl IS DISTINCT FROM b.proacl OR a.proowner<>b.proowner
 OR a.proconfig IS DISTINCT FROM b.proconfig OR a.prosecdef IS DISTINCT FROM b.prosecdef
 OR a.provolatile IS DISTINCT FROM b.provolatile OR a.prosrc IS DISTINCT FROM patched THEN
  RAISE EXCEPTION 'registration_expiry_metadata_drift';
 END IF;
END $patch$;
