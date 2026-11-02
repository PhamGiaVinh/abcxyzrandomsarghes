-- CLI candidate 20261020144104, reserved forward slot214 after catalog check.
-- Add display metadata only. Preserve exact existing authorization and ACL.
-- Recovery: revert the two metadata additions after disabling the UI consumer;
-- retained older clients ignore the additive field. No business data writes.
DO $$ DECLARE old_definition text; new_definition text; before_acl aclitem[];
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'tracker_input_number_owner_required'; END IF;
 old_definition:=replace(pg_get_functiondef('floor_private.tracker_hand_input_context_v4(uuid)'::regprocedure),chr(13),'');
 IF md5(old_definition)<>'588f4bc2f1b8ce3839bb42a635f7b6a0' THEN
  RAISE EXCEPTION 'tracker_input_number_catalog_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='floor_private.tracker_hand_input_context_v4(uuid)'::regprocedure
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']) THEN
  RAISE EXCEPTION 'tracker_input_number_security_drift'; END IF;
 SELECT proacl INTO before_acl FROM pg_proc WHERE oid='floor_private.tracker_hand_input_context_v4(uuid)'::regprocedure;
 new_definition:=replace(old_definition,'gt.id AS table_id,gt.table_name,tt.max_seats,',
  'gt.id AS table_id,gt.table_name,gt.table_number,tt.max_seats,');
 IF new_definition=old_definition THEN RAISE EXCEPTION 'tracker_input_number_select_anchor'; END IF;
 old_definition:=new_definition;
 new_definition:=replace(old_definition,'''table_name'',c.table_name,''max_seats'',c.max_seats,',
  '''table_name'',c.table_name,''table_number'',c.table_number,''max_seats'',c.max_seats,');
 IF new_definition=old_definition THEN RAISE EXCEPTION 'tracker_input_number_payload_anchor'; END IF;
 EXECUTE new_definition;
 IF (SELECT proacl FROM pg_proc WHERE oid='floor_private.tracker_hand_input_context_v4(uuid)'::regprocedure)
   IS DISTINCT FROM before_acl THEN RAISE EXCEPTION 'tracker_input_number_acl_changed'; END IF;
END $$;
