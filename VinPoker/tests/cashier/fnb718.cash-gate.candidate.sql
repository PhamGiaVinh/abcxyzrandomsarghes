-- LOCAL rollback/purpose-clone prototype, not a numbered migration or release installer.
-- Full shift/receipt protocol and multi-session/bank qualification are still open.
DO $$ BEGIN
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (current_database()='vinpoker_ops_cash115_qualified_c' AND current_setting('test.fnb718_rollback',true)='on')
  OR (current_database()='vinpoker_fnb719_gate_local' AND current_setting('test.fnb719_clone',true)='on'
   AND (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())=
    'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948'),
  'explicit rollback or exact owned-clone qualifier required';
 ASSERT to_regprocedure('floor_private.fnb_cash_gate718(uuid)') IS NULL;
 ASSERT md5(pg_get_functiondef('public.fnb_mark_paid(uuid,text)'::regprocedure))='c8d1b825e471fab2038c0552532dbc15';
 ASSERT md5(pg_get_functiondef('public.fnb_cancel_order(uuid,text)'::regprocedure))='7a40b0d5f0103b4dbcf7848079aca94b';
 ASSERT md5(pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure))='779c15e9a2763eb2c8b7b0c0aaea7206';
END $$;
CREATE FUNCTION floor_private.fnb_cash_gate718(p_club_id uuid)
RETURNS void LANGUAGE sql STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fnb-cash-shift:'||p_club_id::text,718));
$$;
REVOKE ALL ON FUNCTION floor_private.fnb_cash_gate718(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE target regprocedure; body text; anchor text;
BEGIN
 FOREACH target IN ARRAY ARRAY['public.fnb_mark_paid(uuid,text)'::regprocedure,
  'public.fnb_cancel_order(uuid,text)'::regprocedure,'public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure] LOOP
  body:=pg_get_functiondef(target);
  anchor:='SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;';
  ASSERT (length(body)-length(replace(body,anchor,'')))/length(anchor)=1,'exact current order-lock seam required';
  body:=replace(body,anchor,
   'PERFORM floor_private.fnb_cash_gate718((SELECT o.club_id FROM public.fnb_orders o WHERE o.id=p_order_id));'||chr(10)||'  '||anchor);
  IF target='public.fnb_cancel_order(uuid,text)'::regprocedure THEN
   anchor:='cancelled_at = now()';
   ASSERT (length(body)-length(replace(body,anchor,'')))/length(anchor)=1,'exact refund timestamp seam required';
   body:=replace(body,anchor,'cancelled_at = clock_timestamp()');
  ELSE
   anchor:='paid_at = now()';
   ASSERT (length(body)-length(replace(body,anchor,'')))/length(anchor)=1,'exact payment timestamp seam required';
   body:=replace(body,anchor,'paid_at = clock_timestamp()');
  END IF;
  EXECUTE body;
 END LOOP;
END $$;
