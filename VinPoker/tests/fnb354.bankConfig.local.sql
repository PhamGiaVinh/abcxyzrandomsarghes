\set ON_ERROR_STOP on
BEGIN;
\if :{?RESTORE}
SELECT set_config('test.fnb354_restore','true',true);
\endif
DO $$ DECLARE bank_id uuid;restoring boolean:=coalesce(current_setting('test.fnb354_restore',true),'')='true';n integer;BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 THEN RAISE EXCEPTION 'exact_local354_only';END IF;
 SELECT (fixture->>'bank')::uuid INTO STRICT bank_id FROM floor_private.fnb350_fixture WHERE fixture->>'fakeBank'='true';
 UPDATE public.platform_bank_accounts
 SET account_number=CASE WHEN restoring THEN 'TEST-NON-BANK350' ELSE 'TEST-CHANGED-NON-BANK350' END,is_active=NOT restoring
 WHERE id=bank_id AND club_id='ddcd5243-42be-49cf-897b-2027a35893e5' AND bank_name='LOCAL TEST350 NOT A BANK'
 AND account_number IN('TEST-NON-BANK350','TEST-CHANGED-NON-BANK350');
 GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'owned354_fake_bank_drift';END IF;
 UPDATE floor_private.fnb350_fixture SET fixture=fixture||jsonb_build_object('bank_config_changed',NOT restoring);
END $$;
COMMIT;
