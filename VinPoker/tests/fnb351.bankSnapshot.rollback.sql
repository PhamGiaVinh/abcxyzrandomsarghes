\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE bank_id uuid;order_id uuid;token text;expected jsonb;actual jsonb;BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data' THEN RAISE EXCEPTION 'local351_only';END IF;
 SELECT (fixture->>'bank')::uuid INTO STRICT bank_id FROM floor_private.fnb350_fixture WHERE fixture->>'fakeBank'='true';
 SELECT x.order_id,t.token,x.result->'bank' INTO STRICT order_id,token,expected
 FROM floor_private.fnb_guest_request_receipts_v1 x JOIN public.fnb_table_qr_tokens t ON t.id=x.token_id
 WHERE x.payload->>'customer_name'='TEST350' AND x.result->>'payment_method'='bank_transfer';
 IF expected->>'account_number'<>'TEST-NON-BANK350' THEN RAISE EXCEPTION 'expected351_fake_snapshot_only';END IF;
 UPDATE public.platform_bank_accounts SET account_number='TEST-CHANGED-NON-BANK350',is_active=true
 WHERE id=bank_id AND bank_name='LOCAL TEST350 NOT A BANK' AND account_number='TEST-NON-BANK350';
 IF NOT FOUND THEN RAISE EXCEPTION 'fake351_bank_drift';END IF;
 PERFORM set_config('role','anon',true);
 actual:=public.fnb_guest_order_status(token,order_id);
 IF actual->'bank' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FNB351_STATUS_BANK_CHANGED_FROM_FROZEN_RECEIPT';END IF;
 PERFORM set_config('role','none',true);
END $$;
SELECT 'FNB351_ACTUAL_ANON_STATUS_PRESERVES_FROZEN_BANK_PASS_ROLLBACK';
ROLLBACK;
