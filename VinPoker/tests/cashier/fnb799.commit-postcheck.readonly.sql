\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ DECLARE f jsonb; club uuid; a uuid; b uuid; ingredient uuid; original text; actual text;
BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT fixture,protected_before INTO STRICT f,original FROM floor_private.fnb799_commit_fixture;
 club:=(f->>'club')::uuid;a:=(f->>'a')::uuid;b:=(f->>'b')::uuid;ingredient:=(f->>'ingredient')::uuid;
 ASSERT (SELECT count(*)=2 FROM public.fnb_orders WHERE club_id=club);
 ASSERT EXISTS(SELECT 1 FROM public.fnb_orders WHERE id=a AND status='paid' AND subtotal_vnd=5000 AND cogs_vnd=2000 AND paid_at IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.fnb_orders WHERE id=b AND status='expired' AND paid_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.fnb_ingredients WHERE id=ingredient AND on_hand=18);
 ASSERT (SELECT count(*)=1 FROM public.fnb_stock_movements WHERE club_id=club);
 ASSERT EXISTS(SELECT 1 FROM public.fnb_stock_movements WHERE club_id=club AND ingredient_id=ingredient AND delta=-2 AND balance_after=18 AND reason='sale' AND ref_type='order' AND ref_id=a);
 ASSERT (SELECT count(*)=1 FROM public.fnb_order_events WHERE club_id=club AND order_id=a AND action='paid');
 ASSERT (SELECT count(*)=1 FROM public.fnb_order_events WHERE club_id=club AND order_id=b AND action='expired');
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_order_events WHERE club_id=club AND ((order_id=a AND action='expired') OR (order_id=b AND action='paid')));
 ASSERT (SELECT count(*)=4 FROM floor_private.fnb799_commit_steps);
 ASSERT EXISTS(SELECT 1 FROM floor_private.fnb799_commit_steps WHERE step='expiry_wins' AND payload->>'payer_wait'='Lock:transactionid');
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x WHERE club_id<>club),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_events x WHERE club_id<>club),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_ingredients x WHERE club_id<>club),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_stock_movements x WHERE club_id<>club),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_cashier_shifts x WHERE club_id<>club),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x WHERE order_id NOT IN(SELECT id FROM public.fnb_orders WHERE club_id=club)),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x)
 )::text) INTO actual;
 ASSERT actual=original,'protected old clone facts changed';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name LIKE 'fnb799-%');
END $$;
ROLLBACK;
SELECT 'FNB799_COMMITTED_PAID5000_COGS2000_EXPIRED_NO_SALE_STOCK18_ONE_DELTA2_NINE_OLD_GROUPS_UNCHANGED_READONLY_PASS';
