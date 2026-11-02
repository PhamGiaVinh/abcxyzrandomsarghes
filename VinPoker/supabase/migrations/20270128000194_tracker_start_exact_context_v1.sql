-- CLI candidate20261019194241 -> reserved forward194 after local catalog check.
-- A client must supply its exact session/epoch to start a hand. Do not infer
-- today's session for a delayed request from a previous table incarnation.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $migration$
DECLARE definition text;marker text;retired text;original_acl aclitem[];
BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.start_hand(uuid,uuid,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),''))<>'4875b3119a00e0d7413fa74df08f4415'
 OR md5(replace(pg_get_functiondef('public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),''))<>'599d94b5e9acd99192008ba79f75cae6'
 OR to_regclass('floor_private.tracker_hand_seat_snapshots193') IS NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000194') THEN
  RAISE EXCEPTION 'tracker_start194_baseline_drift_or_collision';
 END IF;
 SELECT proacl INTO original_acl FROM pg_proc WHERE oid='public.start_hand(uuid,uuid,integer,timestamptz,uuid,integer)'::regprocedure;
 SELECT replace(pg_get_functiondef('public.start_hand(uuid,uuid,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),'') INTO definition;
 marker:='  IF p_button_seat IS NULL';
 retired:=$retired$  -- Retired194: old signature cannot express the caller's session/epoch.
  RETURN jsonb_build_object('error','tracker_exact_session_required','error_code','tracker_exact_session_required');

$retired$;
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_start194_marker_drift';END IF;
 -- Keep existing auth/actor-mismatch checks and exact owner/ACL/config. There
 -- is deliberately no compatibility path that guesses a current session.
 EXECUTE replace(definition,marker,retired||marker);
 IF (SELECT proacl FROM pg_proc WHERE oid='public.start_hand(uuid,uuid,integer,timestamptz,uuid,integer)'::regprocedure) IS DISTINCT FROM original_acl THEN
  RAISE EXCEPTION 'tracker_start194_acl_changed';END IF;
END $migration$;
COMMIT;
