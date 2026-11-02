-- CLI-created20261021062547; forward233 reserved after source collision review.
-- Use the SAME explicit registration-closed predicate as initial registration.
-- No rest/price/payment/window extension. Existing service-only authority retained.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure)
   IS DISTINCT FROM '0c1ec452d3450a6f7cb6b8b6fe32e877'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.is_tournament_registration_closed(uuid)'))
   IS DISTINCT FROM '6556502effc5542786036193a61d41f8'
 OR to_regclass('floor_private.cashier_reentry_release_backup233') IS NOT NULL THEN
  RAISE EXCEPTION 'reentry233_precondition_drift';END IF;
END $$;
CREATE TABLE floor_private.cashier_reentry_release_backup233(
 id boolean PRIMARY KEY CHECK(id),saved_definition text NOT NULL,old_md5 text NOT NULL,
 owner_name text NOT NULL,saved_acl aclitem[]
);
ALTER TABLE floor_private.cashier_reentry_release_backup233 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.cashier_reentry_release_backup233 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.cashier_reentry_release_backup233
 SELECT true,pg_get_functiondef(oid),md5(prosrc),pg_get_userbyid(proowner),proacl FROM pg_proc
 WHERE oid='public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure;
DO $patch$ DECLARE definition text;anchor text:=E' IF tour.status IN (''completed'',''cancelled'') OR\n'; BEGIN
 SELECT saved_definition INTO STRICT definition FROM floor_private.cashier_reentry_release_backup233 WHERE id;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'reentry233_anchor_missing';END IF;
 definition:=replace(definition,anchor,E' IF tour.status IN (''completed'',''cancelled'') OR public.is_tournament_registration_closed(tour.id) OR\n');
 EXECUTE definition;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN floor_private.cashier_reentry_release_backup233 b
  WHERE p.oid='public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure
  AND (p.proacl IS DISTINCT FROM b.saved_acl OR pg_get_userbyid(p.proowner) IS DISTINCT FROM b.owner_name)) THEN
  RAISE EXCEPTION 'reentry233_acl_owner_changed';END IF;
END $patch$;
COMMIT;
