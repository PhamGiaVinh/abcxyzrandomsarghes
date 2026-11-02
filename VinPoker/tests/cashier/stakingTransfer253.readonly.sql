BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
SET LOCAL request.jwt.claim.sub='1cc90e71-883d-40c0-8671-1f38929ecadc';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb;BEGIN
 result:=public.get_staking_purchase_transfer_v1('aee6e467-b57d-4cee-a7bc-f8f237b8c9db');
 ASSERT result->>'state'='verified';
 ASSERT result->'bank'->>'bank_name'='LOCAL516_RECEIPT_BANK';
 ASSERT result->'bank'->>'account_number'='LOCAL_ONLY_516';
 ASSERT (result->>'amount_vnd')::bigint=100000;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.get_staking_purchase_transfer_v1('aee6e467-b57d-4cee-a7bc-f8f237b8c9db');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 ASSERT denied;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.get_staking_purchase_transfer_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_staking_purchase_transfer_v1(uuid)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','public.staking_purchase_receipts_v1','SELECT');
 RAISE NOTICE 'TRANSFER253 actual-backersnapshot/outsider/anon/service/private-table PASS';
END $$;
ROLLBACK;
