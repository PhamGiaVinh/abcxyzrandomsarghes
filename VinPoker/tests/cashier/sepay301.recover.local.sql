-- Explicit LOCAL recovery only. Does not delete movements/receipts/backup or ledger.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ DECLARE saved record; BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1'
  OR inet_server_port()<>55441 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
  OR to_regclass('floor_private.sepay301_definition_backup') IS NULL THEN RAISE EXCEPTION 'sepay301_local_recovery_target'; END IF;
 IF (SELECT count(*) FROM floor_private.sepay301_definition_backup)<>2
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.manual_confirm_bank_transaction(uuid,uuid,text)'::regprocedure)<>'cfea401fd07d9954734ef0cfcebe87bd'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cashier_retry_paid_seating_v1(boolean,integer)'::regprocedure)<>'20f667742e9929e5db7fbdd355a8c023'
 THEN RAISE EXCEPTION 'sepay301_recovery_definition_drift'; END IF;
 FOR saved IN SELECT * FROM floor_private.sepay301_definition_backup ORDER BY signature LOOP
  EXECUTE saved.definition;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(saved.signature))<>saved.body_md5 THEN
   RAISE EXCEPTION 'sepay301_restore_verification_failed'; END IF;
 END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb) FROM authenticated;
COMMIT;
