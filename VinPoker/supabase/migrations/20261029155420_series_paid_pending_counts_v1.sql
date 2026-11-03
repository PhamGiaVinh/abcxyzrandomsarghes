-- LOCAL qualification candidate; not promoted / not for production DB push.
-- Paid registration counts must not wait for seating. Preserve all owner/tenant,
-- date, fee and prize fields. Do not rewrite the append-only Capture journal or
-- finalized actuals. Execute inside a guarded transaction on an owned local DB.
-- Recovery: execute the exact saved definition; never recompute financial rows.
DO $patch$
DECLARE b record;a record;needle text;replacement text;patched text;
BEGIN
 SELECT p.*,pg_get_functiondef(p.oid) definition INTO STRICT b
 FROM pg_proc p
 WHERE p.oid='public.get_club_series_events(uuid,timestamptz,timestamptz)'::regprocedure;
 IF current_user<>'postgres' OR md5(b.prosrc)<>'52613a8153f45b47a0d95513972c51db'
 OR pg_get_userbyid(b.proowner)<>'postgres' OR NOT b.prosecdef OR b.provolatile<>'s'
 OR to_regclass('floor_private.series_paid_pending_counts_definition_backup_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'series_paid_pending_counts_dependency_drift_or_collision';
 END IF;
 needle:=E'      and tr.status = ''confirmed''';
 replacement:=E'      and (tr.status = ''confirmed''\n           or (tr.status = ''pending'' and tr.cashier_paid_at is not null))';
 IF strpos(b.prosrc,needle)=0
 OR (length(b.prosrc)-length(replace(b.prosrc,needle,'')))<>length(needle) THEN
  RAISE EXCEPTION 'series_paid_pending_counts_predicate_drift';
 END IF;
 CREATE TABLE floor_private.series_paid_pending_counts_definition_backup_v1(
  signature text PRIMARY KEY,definition text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.series_paid_pending_counts_definition_backup_v1 ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.series_paid_pending_counts_definition_backup_v1 FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.series_paid_pending_counts_definition_backup_v1(signature,definition)
 VALUES('public.get_club_series_events(uuid,timestamptz,timestamptz)',b.definition);
 patched:=replace(b.prosrc,needle,replacement);
 EXECUTE replace(b.definition,b.prosrc,patched);
 SELECT * INTO STRICT a FROM pg_proc WHERE oid=b.oid;
 IF a.proacl IS DISTINCT FROM b.proacl OR a.proowner<>b.proowner
 OR a.proconfig IS DISTINCT FROM b.proconfig OR a.prosecdef IS DISTINCT FROM b.prosecdef
 OR a.provolatile IS DISTINCT FROM b.provolatile OR a.prosrc IS DISTINCT FROM patched THEN
  RAISE EXCEPTION 'series_paid_pending_counts_metadata_drift';
 END IF;
END $patch$;
