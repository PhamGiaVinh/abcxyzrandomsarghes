\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE f jsonb; r jsonb; q integer; before_count bigint;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 THEN RAISE EXCEPTION 'exact345_local_only';END IF;
 SELECT fixture INTO f FROM floor_private.fnb335_fixture;
 IF f->>'completed'<>'true' THEN RAISE EXCEPTION 'retained335_required';END IF;
 SELECT count(*) INTO before_count FROM public.fnb_orders;
 FOREACH q IN ARRAY ARRAY[0,21] LOOP
  PERFORM set_config('role','anon',true);
  BEGIN
   r:=public.fnb_guest_create_order(f->'tokens'->>0,3::smallint,'TEST345',NULL,
    jsonb_build_array(jsonb_build_object('menu_item_id',f->>'item','qty',q)),'cash',gen_random_uuid()::text);
   RAISE EXCEPTION 'invalid_qty345_did_not_raise';
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'INVALID_QTY' THEN RAISE;END IF;
  END;
  PERFORM set_config('role','none',true);
  IF (SELECT count(*) FROM public.fnb_orders)<>before_count THEN RAISE EXCEPTION 'invalid_qty345_partial_order';END IF;
 END LOOP;
 PERFORM set_config('role','anon',true);
 r:=public.fnb_guest_create_order(f->'tokens'->>0,3::smallint,'TEST345',NULL,
   jsonb_build_array(jsonb_build_object('menu_item_id',f->>'item','qty',20)),'cash',gen_random_uuid()::text);
 IF r->>'status' IS DISTINCT FROM 'ok' OR r->>'subtotal_vnd'<>'200000' THEN RAISE EXCEPTION 'max_qty345_rejected';END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.fnb_orders)<>before_count+1 THEN RAISE EXCEPTION 'max_qty345_wrong_count';END IF;
END $$;
SELECT 'FNB345_ZERO_21_REJECT_ATOMIC_20_ACCEPT_PASS_ROLLBACK';
ROLLBACK;
