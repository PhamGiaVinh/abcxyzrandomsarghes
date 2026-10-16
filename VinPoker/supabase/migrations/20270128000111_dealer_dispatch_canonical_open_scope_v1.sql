-- CLI candidate20261016075956, local catalog111. NOT RELEASED.
-- A live empty session is work even before the first attendance/assignment.
-- Reuse canonical inventory; retain existing approved/AutoON/legacy work gates.
-- Read-only selector change: no table opening, assignments, rest or payroll edit.
-- Recovery: capture previous definition/ACL, restore by reviewed forward migration
-- with Auto OFF. Never delete assignment/schedule/attendance history to revert.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 target regprocedure:='public.get_process_swing_due_club_ids()'::regprocedure;
 definition text;
 anchor text:=E'    AND (\n      EXISTS (';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF md5(definition)<>'8657d9e571259baf98634a01038a9705' THEN
  RAISE EXCEPTION 'dispatcher_due111_definition_drift';END IF;
 IF md5(replace(pg_get_functiondef('floor_private.club_operational_inventory(uuid)'::regprocedure),chr(13),''))<>'8d75ddb69e4639aabaa9b3347b3cc921' THEN
  RAISE EXCEPTION 'dispatcher_due111_inventory_drift';END IF;
 IF has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('authenticated',target,'EXECUTE')
  OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
  RAISE EXCEPTION 'dispatcher_due111_acl_drift';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid=target AND a.grantee NOT IN (p.proowner,'service_role'::regrole::oid)) THEN
  RAISE EXCEPTION 'dispatcher_due111_unreviewed_grantee';END IF;
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'dispatcher_due111_anchor_mismatch';END IF;
 definition:=replace(definition,anchor,
  E'    AND (\n      EXISTS (\n        SELECT 1\n        FROM floor_private.club_operational_inventory(c.id) AS i\n        JOIN public.table_sessions AS s ON s.id = i.table_session_id\n          AND s.game_table_id = i.game_table_id AND s.club_id = c.id AND s.closed_at IS NULL\n        WHERE i.availability_status = ''in_use''\n      )\n      OR EXISTS (');
 EXECUTE definition;
END;
$patch$;
COMMIT;
