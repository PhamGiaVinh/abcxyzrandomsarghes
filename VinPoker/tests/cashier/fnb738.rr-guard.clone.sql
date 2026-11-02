BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regclass('floor_private.fnb738_pre_rr_backup') IS NULL,'constructor consumed; preserve failed evidence';
 ASSERT md5(pg_get_functiondef('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure))='0e39af1bd0bf5ded619632f62a3e97b2';
 ASSERT md5(pg_get_functiondef('public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)'::regprocedure))='0807a693569be9e37eccc5020d8a8830';
END $$;
CREATE TABLE floor_private.fnb738_pre_rr_backup AS SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig
 FROM pg_proc WHERE oid IN('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure,'public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)'::regprocedure);
ALTER TABLE floor_private.fnb738_pre_rr_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb738_pre_rr_backup FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE definition text;marker text;
BEGIN
 definition:=pg_get_functiondef('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure);
 marker:='  -- Both callers check admission before waiting.';
 ASSERT strpos(definition,marker)>0;
 definition:=replace(definition,marker,$guard$  IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'FNB_CREATE_READ_COMMITTED_REQUIRED' USING ERRCODE='40001';
  END IF;
$guard$||marker);EXECUTE definition;
 definition:=pg_get_functiondef('public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)'::regprocedure);
 marker:=' PERFORM pg_catalog.pg_advisory_xact_lock';ASSERT strpos(definition,marker)>0;
 definition:=replace(definition,marker,$guard$ IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'FNB_CREATE_READ_COMMITTED_REQUIRED' USING ERRCODE='40001';
 END IF;
$guard$||marker);EXECUTE definition;
END $patch$;
COMMIT;
