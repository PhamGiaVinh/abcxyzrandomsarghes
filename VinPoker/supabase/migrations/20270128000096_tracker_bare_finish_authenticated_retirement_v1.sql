-- CLI candidate20261015212920; local forward96 only, not production approved.
-- Requires95 DB + reviewed Edge/UI exact-intent consumers already available.
-- Retire direct browser Finish without changing the core implementation that
-- the scoped manual/Voice SECURITY DEFINER entrypoints call as postgres.
-- Recovery: keep95 consumers working; a reviewed forward grant change is needed
-- to reopen unsafe legacy access. Never rewind completed hands or receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
DECLARE core regprocedure:='public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure;
BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef(core),chr(13),''))<>'514d543b756792fcfc3277faa325d991'
 OR md5(replace(pg_get_functiondef('public.record_tracker_manual_hand_v1(jsonb)'::regprocedure),chr(13),''))<>'29c8223e91774dc4767ab72a334e7b56'
 OR md5(replace(pg_get_functiondef('public.get_tracker_manual_finish_receipt_v1(jsonb)'::regprocedure),chr(13),''))<>'0c8908aa7ba9176653abe50aa3472025'
 OR NOT has_function_privilege('authenticated',core,'EXECUTE')
 OR has_function_privilege('authenticated','public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure,'EXECUTE')
 OR NOT has_function_privilege('authenticated','public.record_tracker_manual_hand_v1(jsonb)'::regprocedure,'EXECUTE')
 OR NOT has_function_privilege('authenticated','public.get_tracker_manual_finish_receipt_v1(jsonb)'::regprocedure,'EXECUTE') THEN
  RAISE EXCEPTION 'manual_finish96_dependency_or_acl_drift'; END IF;
END;
$guard$;
REVOKE ALL ON FUNCTION public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
DO $postcheck$ BEGIN
 IF has_function_privilege('authenticated','public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure,'EXECUTE')
 OR has_function_privilege('anon','public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure,'EXECUTE')
 OR has_function_privilege('service_role','public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure,'EXECUTE') THEN
  RAISE EXCEPTION 'manual_finish96_retirement_failed'; END IF;
END;
$postcheck$;
COMMIT;
