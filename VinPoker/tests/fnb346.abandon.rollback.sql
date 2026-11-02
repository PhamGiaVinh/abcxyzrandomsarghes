\set ON_ERROR_STOP on
DO $$
DECLARE f jsonb;r jsonb;key_id text:=gen_random_uuid()::text;lines jsonb;before_count bigint;v_token_id uuid;used_budget integer;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data' THEN RAISE EXCEPTION 'exact_local346_required';END IF;
 IF to_regprocedure('public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)') IS NULL
 THEN RAISE EXCEPTION 'FNB346_ABANDON_RPC_MISSING';END IF;
 SELECT fixture INTO f FROM floor_private.fnb335_fixture;
 IF f->>'completed'<>'true' THEN RAISE EXCEPTION 'retained335_required';END IF;
 SELECT id INTO v_token_id FROM public.fnb_table_qr_tokens WHERE token=f->'tokens'->>0;
 SELECT count(*) INTO used_budget FROM floor_private.fnb_guest_request_receipts_v1 r
 WHERE r.token_id=v_token_id AND r.order_id IS NULL AND r.created_at>now()-interval '10 minutes';
 IF used_budget>=10 THEN RAISE EXCEPTION 'fixture346_budget_exhausted_no_reset';END IF;
 SELECT count(*) INTO before_count FROM public.fnb_orders;
 IF NOT has_function_privilege('anon','public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)','EXECUTE')
 OR has_function_privilege('service_role','public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'abandon346_acl';END IF;
 lines:=jsonb_build_array(jsonb_build_object('menu_item_id',f->>'item','qty',1));
 PERFORM set_config('role','anon',true);
 r:=public.fnb_guest_abandon_request_v1(f->'tokens'->>0,3::smallint,'TEST346',NULL,lines,'cash',key_id);
 IF r #>> '{receipt,error}' IS DISTINCT FROM 'REQUEST_ABANDONED' OR r->>'request_id' IS DISTINCT FROM key_id THEN RAISE EXCEPTION 'abandon346_not_fenced';END IF;
 r:=public.fnb_guest_create_order(f->'tokens'->>0,3::smallint,'TEST346',NULL,lines,'cash',key_id);
 IF r->>'error' IS DISTINCT FROM 'REQUEST_ABANDONED' THEN RAISE EXCEPTION 'late_create346_not_denied';END IF;
 r:=public.fnb_guest_order_receipt_v1(f->'tokens'->>0,3::smallint,'TEST346',NULL,lines,'cash',key_id);
 IF r #>> '{receipt,error}' IS DISTINCT FROM 'REQUEST_ABANDONED' OR r->>'found'<>'true' THEN RAISE EXCEPTION 'abandon346_read_missing';END IF;
 r:=public.fnb_guest_abandon_request_v1(f->'tokens'->>0,3::smallint,'TEST346',NULL,lines,'cash',key_id);
 IF r #>> '{receipt,idempotent}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'abandon346_not_replayable';END IF;
 r:=public.fnb_guest_abandon_request_v1(f->'tokens'->>0,4::smallint,'TEST346',NULL,lines,'cash',key_id);
 IF r->>'error' IS DISTINCT FROM 'REQUEST_ID_CONFLICT' THEN RAISE EXCEPTION 'abandon346_payload_not_bound';END IF;
 r:=public.fnb_guest_order_receipt_v1(f->'tokens'->>1,3::smallint,'TEST346',NULL,lines,'cash',key_id);
 IF r->>'found' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'abandon346_token_leak';END IF;
 -- A committed order wins; abandon must return it, never cancel or edit it.
 r:=public.fnb_guest_abandon_request_v1(f->'tokens'->>0,3::smallint,'TEST',NULL,lines,'cash',f->'keys'->>0);
 IF r #>> '{receipt,status}' IS DISTINCT FROM 'ok' OR r #>> '{receipt,order_id}' IS NULL THEN RAISE EXCEPTION 'abandon346_changed_existing_order';END IF;
 r:=public.fnb_guest_abandon_request_v1('LOCAL-INVALID346',3::smallint,'TEST346',NULL,lines,'cash',key_id);
 IF r->>'error' IS DISTINCT FROM 'TOKEN_INVALID' THEN RAISE EXCEPTION 'abandon346_invalid_token';END IF;
 FOR q IN 1..(9-used_budget) LOOP
  r:=public.fnb_guest_abandon_request_v1(f->'tokens'->>0,3::smallint,'TEST346',NULL,lines,'cash',gen_random_uuid()::text);
  IF r #>> '{receipt,error}' IS DISTINCT FROM 'REQUEST_ABANDONED' THEN RAISE EXCEPTION 'abandon346_budget_wrong';END IF;
 END LOOP;
 r:=public.fnb_guest_abandon_request_v1(f->'tokens'->>0,3::smallint,'TEST346',NULL,lines,'cash',gen_random_uuid()::text);
 IF r->>'error' IS DISTINCT FROM 'RATE_LIMITED' THEN RAISE EXCEPTION 'abandon346_unbounded';END IF;
 r:=public.fnb_guest_abandon_request_v1(f->'tokens'->>0,3::smallint,'TEST346',NULL,lines,'cash',key_id);
 IF r #>> '{receipt,error}' IS DISTINCT FROM 'REQUEST_ABANDONED' THEN RAISE EXCEPTION 'abandon346_replay_rate_blocked';END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.fnb_orders)<>before_count THEN RAISE EXCEPTION 'abandon346_created_order';END IF;
 BEGIN
  INSERT INTO floor_private.fnb_guest_request_receipts_v1(token_id,request_id,payload,result,order_id)
   VALUES(v_token_id,gen_random_uuid()::text,'{}','{}',NULL);
  RAISE EXCEPTION 'abandon346_null_check_loophole';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
SELECT 'FNB346_ANON_ABANDON_LATE_CREATE_PAYLOAD_SCOPE_EXISTING_ORDER_CONSTRAINT_PASS_ROLLBACK_ONLY';
