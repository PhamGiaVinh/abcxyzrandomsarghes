\set ON_ERROR_STOP on
DO $$
DECLARE f jsonb;before_counts jsonb;after_counts jsonb;r jsonb;lines jsonb;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local336_only';END IF;
 SELECT fixture INTO f FROM floor_private.fnb335_fixture;
 IF f->>'completed'<>'true' THEN RAISE EXCEPTION 'retained335_not_complete';END IF;
 SELECT jsonb_build_object('orders',(SELECT count(*) FROM public.fnb_orders),
  'items',(SELECT count(*) FROM public.fnb_order_items),'events',(SELECT count(*) FROM public.fnb_order_events),
  'receipts',(SELECT count(*) FROM floor_private.fnb_guest_request_receipts_v1)) INTO before_counts;
 IF NOT has_function_privilege('anon','public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text)','EXECUTE')
 OR has_function_privilege('service_role','public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'receipt336_acl_wrong';END IF;
 lines:=jsonb_build_array(jsonb_build_object('menu_item_id',f->>'item','qty',1));
 PERFORM set_config('role','anon',true);
 r:=public.fnb_guest_order_receipt_v1(f->'tokens'->>0,3::smallint,'TEST',NULL,lines,'cash',f->'keys'->>0);
 IF r->>'found' IS DISTINCT FROM 'true' OR r #>> '{receipt,subtotal_vnd}'<>'10000'
 OR r #>> '{receipt,idempotent}'<>'true' OR r->>'request_id' IS DISTINCT FROM f->'keys'->>0
 THEN RAISE EXCEPTION 'receipt336_existing_wrong';END IF;
 r:=public.fnb_guest_order_receipt_v1(f->'tokens'->>0,3::smallint,'TEST',NULL,lines,'cash',gen_random_uuid()::text);
 IF r->>'found' IS DISTINCT FROM 'false' OR r->'receipt' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'receipt336_absence_not_explicit';END IF;
 r:=public.fnb_guest_order_receipt_v1(f->'tokens'->>0,3::smallint,'TEST',NULL,jsonb_build_array(jsonb_build_object('menu_item_id',f->>'item','qty',2)),'cash',f->'keys'->>0);
 IF r->>'error' IS DISTINCT FROM 'REQUEST_ID_CONFLICT' THEN RAISE EXCEPTION 'receipt336_payload_not_bound';END IF;
 r:=public.fnb_guest_order_receipt_v1(f->'tokens'->>1,3::smallint,'TEST',NULL,lines,'cash',f->'keys'->>0);
 IF r->>'found' IS DISTINCT FROM 'false' OR r->'receipt' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'receipt336_cross_token_leak';END IF;
 r:=public.fnb_guest_order_receipt_v1('LOCAL-INVALID336',3::smallint,'TEST',NULL,lines,'cash',f->'keys'->>0);
 IF r->>'error' IS DISTINCT FROM 'TOKEN_INVALID' THEN RAISE EXCEPTION 'receipt336_invalid_token_accepted';END IF;
 PERFORM set_config('role','none',true);
 SELECT jsonb_build_object('orders',(SELECT count(*) FROM public.fnb_orders),
  'items',(SELECT count(*) FROM public.fnb_order_items),'events',(SELECT count(*) FROM public.fnb_order_events),
  'receipts',(SELECT count(*) FROM floor_private.fnb_guest_request_receipts_v1)) INTO after_counts;
 IF before_counts IS DISTINCT FROM after_counts THEN RAISE EXCEPTION 'receipt336_read_created_or_changed_counts';END IF;
END $$;
SELECT 'FNB336_ANON_RECEIPT_FOUND_MISSING_SCOPE_PAYLOAD_READ_ONLY_PASS';
